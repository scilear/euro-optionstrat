"""
CSFF business logic — scan orchestration, job tracking, ticker management,
PG queries for report metadata.

Runs scanner scripts as subprocesses with progress tracking via in-memory
job state. Three independent operations with separate lock files:
  - Universe scan (ff_universe_scan.py)
  - Intraday scan / price (ff_trade_scanner.py)
  - Single-ticker refresh (ff_trade_scanner.py --universe <ticker-filtered temp CSV>)
"""

from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import date
from pathlib import Path

SCANNER_DIR = Path(__file__).resolve().parent.parent.parent / "scanner"
DATA_DIR = Path(os.environ.get("CSFF_DATA_DIR", str(SCANNER_DIR.parent / "csff_data")))
REPORTS_DIR = Path(os.environ.get("CSFF_REPORTS_DIR", str(SCANNER_DIR.parent / "static" / "csff" / "reports")))

TICKER_FILE = DATA_DIR / "tickers.json"
READY_STATS_FILE = DATA_DIR / "ready_stats.json"

TICKER_RE = re.compile(r"^[A-Z]{1,5}$")


class JobState:
    def __init__(self, job_id: str, scan_type: str):
        self.job_id = job_id
        self.scan_type = scan_type
        self.status = "queued"
        self.progress = ""
        self.result: dict | None = None
        self.error: str | None = None
        self.created_at = time.time()
        self.completed_at: float | None = None


class CsffService:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, JobState] = {}
        self._scan_lock = threading.Lock()

    # ── Ticker management ────────────────────────────────────────────────────

    def get_tickers(self) -> list[str]:
        if TICKER_FILE.exists():
            try:
                data = json.loads(TICKER_FILE.read_text())
                return data if isinstance(data, list) else []
            except (json.JSONDecodeError, OSError):
                pass
        return ["SPY", "QQQ", "IWM", "XLK", "XLF", "GLD", "TLT", "EFA"]

    def save_tickers(self, tickers_str: str) -> list[str]:
        parts = [t.strip().upper() for t in tickers_str.split(",") if t.strip()]
        validated = [t for t in parts if TICKER_RE.match(t)]
        TICKER_FILE.write_text(json.dumps(validated, indent=2))
        return validated

    # ── Report listing ───────────────────────────────────────────────────────

    def list_reports(self, max_dates: int = 30) -> dict:
        if not REPORTS_DIR.exists():
            return {"dates": [], "latest": None, "total_reports": 0}
        date_dirs = sorted(
            (d for d in REPORTS_DIR.iterdir() if d.is_dir() and d.name[:4].isdigit()),
            reverse=True,
        )[:max_dates]
        dates = []
        total = 0
        for d in date_dirs:
            index_file = d / "index.html"
            if not index_file.exists():
                continue
            ticker_reports = sorted(f.stem.replace("_report", "") for f in d.glob("*_report.html"))
            dates.append({
                "date": d.name,
                "tickers": ticker_reports,
                "count": len(ticker_reports),
            })
            total += len(ticker_reports)
        latest = dates[0]["date"] if dates else None
        return {"dates": dates, "latest": latest, "total_reports": total}

    def get_date_index(self, date_str: str) -> dict | None:
        index_file = REPORTS_DIR / date_str / "index.html"
        if not index_file.exists():
            return None
        html = index_file.read_text(encoding="utf-8")
        ticker_reports = sorted(
            f.stem.replace("_report", "")
            for f in (REPORTS_DIR / date_str).glob("*_report.html")
        )
        return {"date": date_str, "tickers": ticker_reports, "html": html}

    def get_ticker_report(self, date_str: str, ticker: str) -> dict | None:
        report_file = REPORTS_DIR / date_str / f"{ticker}_report.html"
        if not report_file.exists():
            return None
        html = report_file.read_text(encoding="utf-8")
        return {"date": date_str, "ticker": ticker, "html": html}

    # ── Scan execution ───────────────────────────────────────────────────────

    def start_scan(self, scan_type: str = "universe", tickers_str: str | None = None) -> dict:
        if not self._scan_lock.acquire(blocking=False):
            return {"error": "scan already running", "status": "in_progress"}

        try:
            job_id = str(uuid.uuid4())
            job = JobState(job_id, scan_type)
            self._jobs[job_id] = job

            if scan_type == "universe":
                thread = threading.Thread(
                    target=self._run_universe_scan,
                    args=(job, tickers_str),
                    daemon=True,
                )
            elif scan_type == "intraday":
                thread = threading.Thread(
                    target=self._run_intraday_scan,
                    args=(job, tickers_str),
                    daemon=True,
                )
            else:
                self._scan_lock.release()
                return {"error": f"unknown scan type: {scan_type}"}

            thread.start()
            return {"job_id": job_id, "status": "queued"}
        except Exception as exc:
            self._scan_lock.release()
            return {"error": str(exc)}

    def _read_progress_stream(self, job: JobState, pipe):
        """Read subprocess stdout line-by-line, updating job.progress on PROGRESS: lines."""
        lines = []
        for raw_line in pipe:
            line = raw_line.rstrip("\n")
            lines.append(line)
            if line.startswith("PROGRESS:"):
                job.progress = line[len("PROGRESS:"):].strip()
        return "\n".join(lines)

    def _run_subprocess_with_progress(self, job: JobState, cmd: list[str], env: dict, timeout: int) -> dict:
        """
        Run cmd, streaming stdout progress into job.progress, and return its outcome.

        stderr is drained concurrently on a background thread. Reading stdout to EOF
        before touching stderr (the previous approach) deadlocks as soon as the child
        writes enough to stderr to fill the OS pipe buffer (64KB on Linux) while stdout
        is quiet: the child blocks on the stderr write, and the parent — stuck waiting
        on the next stdout line — never notices. proc.wait(timeout=...) is powerless
        against this because it's only reached after the stdout read returns, so a
        watchdog timer kills the process directly on timeout instead.
        """
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
        )

        stderr_chunks: list[str] = []
        stderr_thread = threading.Thread(
            target=lambda: stderr_chunks.append(proc.stderr.read()), daemon=True,
        )
        stderr_thread.start()

        timed_out = threading.Event()

        def _kill_on_timeout():
            timed_out.set()
            proc.kill()

        watchdog = threading.Timer(timeout, _kill_on_timeout)
        watchdog.start()
        try:
            stdout = self._read_progress_stream(job, proc.stdout)
        finally:
            watchdog.cancel()

        stderr_thread.join(timeout=10)
        stderr = stderr_chunks[0] if stderr_chunks else ""
        returncode = proc.wait()

        return {
            "returncode": returncode,
            "stdout": stdout,
            "stderr": stderr,
            "timed_out": timed_out.is_set(),
        }

    def _run_universe_scan(self, job: JobState, tickers_str: str | None):
        try:
            job.status = "running"
            cmd = [sys.executable or "python3", str(SCANNER_DIR / "ff_universe_scan.py")]
            env = os.environ.copy()
            if tickers_str:
                tickers = [t.strip() for t in tickers_str.split(",") if t.strip() and TICKER_RE.match(t.strip())]
                if tickers:
                    cmd.extend(["--tickers"] + tickers)
            cmd.extend(["--output-dir", str(REPORTS_DIR / "universe")])
            job.progress = "starting universe scan"
            result = self._run_subprocess_with_progress(job, cmd, env, timeout=1800)
            if result["timed_out"]:
                job.status = "failed"
                job.error = "timed out after 1800s"
            elif result["returncode"] != 0:
                job.status = "failed"
                job.error = result["stderr"].strip() or f"exit code {result['returncode']}"
            else:
                job.status = "done"
                job.result = {"stdout": result["stdout"], "stderr": result["stderr"], "exit_code": 0}
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
        finally:
            job.completed_at = time.time()
            self._scan_lock.release()

    def _write_filtered_universe(self, source_csv: Path, tickers: set[str]) -> Path:
        """
        Write a temp copy of source_csv containing only the given tickers.

        ff_trade_scanner.py takes its ticker scope from --universe FILE only — it has
        no --ticker/--tickers CLI flag — so restricting a scan to specific tickers means
        pre-filtering the candidates CSV ourselves before pointing --universe at it.
        """
        with open(source_csv, newline="") as f:
            reader = csv.DictReader(f)
            rows = [r for r in reader if r.get("ticker", "").strip().upper() in tickers]
            fieldnames = reader.fieldnames

        fd, tmp_path = tempfile.mkstemp(suffix="_candidates.csv", prefix="csff_filtered_")
        with os.fdopen(fd, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        return Path(tmp_path)

    def _run_intraday_scan(self, job: JobState, tickers_str: str | None):
        tmp_universe_file = None
        try:
            job.status = "running"
            universe_dir = REPORTS_DIR / "universe"
            latest_csv = universe_dir / "latest_candidates.csv"
            cmd = [sys.executable or "python3", str(SCANNER_DIR / "ff_trade_scanner.py")]
            env = os.environ.copy()
            env["CSFF_REPORTS_DIR"] = str(REPORTS_DIR)

            universe_path = latest_csv
            if tickers_str and latest_csv.exists():
                tickers = {t.strip().upper() for t in tickers_str.split(",") if t.strip() and TICKER_RE.match(t.strip())}
                if tickers:
                    tmp_universe_file = self._write_filtered_universe(latest_csv, tickers)
                    universe_path = tmp_universe_file

            if universe_path.exists():
                cmd.extend(["--universe", str(universe_path)])

            job.progress = "starting intraday scan"
            result = self._run_subprocess_with_progress(job, cmd, env, timeout=600)
            if result["timed_out"]:
                job.status = "failed"
                job.error = "timed out after 600s"
            elif result["returncode"] != 0:
                job.status = "failed"
                job.error = result["stderr"].strip() or f"exit code {result['returncode']}"
            else:
                job.status = "done"
                job.result = {"stdout": result["stdout"], "stderr": result["stderr"], "exit_code": 0}
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
        finally:
            if tmp_universe_file:
                tmp_universe_file.unlink(missing_ok=True)
            job.completed_at = time.time()
            self._scan_lock.release()

    def refresh_ticker(self, ticker: str) -> dict:
        tmp_universe_file = None
        try:
            latest_csv = REPORTS_DIR / "universe" / "latest_candidates.csv"
            cmd = [sys.executable or "python3", str(SCANNER_DIR / "ff_trade_scanner.py")]
            env = os.environ.copy()
            env["CSFF_REPORTS_DIR"] = str(REPORTS_DIR)
            if latest_csv.exists():
                tmp_universe_file = self._write_filtered_universe(latest_csv, {ticker.upper()})
                cmd.extend(["--universe", str(tmp_universe_file)])
            else:
                return {"error": "no universe scan has run yet — run a full universe scan first"}
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=120, env=env,
            )
            if result.returncode != 0:
                return {"error": result.stderr.strip() or f"exit code {result.returncode}"}
            report_data = self.get_ticker_report(date.today().isoformat(), ticker)
            if report_data:
                return report_data
            return {"ticker": ticker, "status": "refreshed"}
        except subprocess.TimeoutExpired:
            return {"error": "timed out after 120s"}
        except Exception as exc:
            return {"error": str(exc)}
        finally:
            if tmp_universe_file:
                tmp_universe_file.unlink(missing_ok=True)

    # ── Job status ──────────────────────────────────────────────────────────

    def get_job_status(self, job_id: str) -> dict | None:
        job = self._jobs.get(job_id)
        if not job:
            return None
        return {
            "job_id": job.job_id,
            "status": job.status,
            "scan_type": job.scan_type,
            "progress": job.progress,
            "error": job.error,
            "result": job.result,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
        }



