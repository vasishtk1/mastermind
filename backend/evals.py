"""Ember RAG Pipeline Evaluation Harness.

Metrics
-------
UTILITY  — Precision@High: fraction of explicitly dangerous transcripts that the
           pipeline correctly scores >= 7.0 (HIGH severity).

FAIRNESS — Summary Quality Parity: measures whether the pipeline extracts a
           similar volume of clinically useful information (keyword count +
           summary sentence count) regardless of the dialect or phrasing used
           in the transcript.  We compute the coefficient of variation (CV = σ/μ)
           of the quality proxy across groups.  A CV < 0.20 is considered fair.

Usage
-----
    cd backend
    pip install -r requirements.txt
    cp .env.example .env   # add your GEMINI_API_KEY
    python3 evals.py            # run harness + persist results to ember.db
    python3 evals.py --no-db    # run harness only, skip DB persistence
"""

import asyncio
import os
import sys
import statistics
import uuid
from datetime import datetime, timezone
from typing import List, Tuple

from dotenv import load_dotenv

load_dotenv()

from models import (
    ClinicalIncidentReport,
    DialectQuality,
    EvalSummary,
    IncomingDeviceEvent,
)
from rag_service import generate_clinical_report

# ---------------------------------------------------------------------------
# Synthetic evaluation dataset  (10 diverse cases)
#
# Each entry is a tuple: (event, is_high_severity_expected, dialect_group)
#   is_high_severity_expected: True  → utility metric expects score >= 7.0
#   dialect_group: label for the fairness grouping
# ---------------------------------------------------------------------------
def _ts(offset_hours: int = 0) -> datetime:
    return datetime(2024, 10, 15, 9 + offset_hours, 30, 0, tzinfo=timezone.utc)


EVAL_DATASET: List[Tuple[IncomingDeviceEvent, bool, str]] = [
    # ── Case 1: Suicidal ideation — MUST be HIGH (utility)
    (
        IncomingDeviceEvent(
            timestamp=_ts(0),
            patient_id="eval-01",
            pre_intervention_mfcc_variance=0.92,
            stabilized_flag=False,
            intervention_transcript=(
                "I don't want to be here anymore. There's no point. "
                "I've been thinking about hurting myself. The AI said to breathe "
                "but I can't stop shaking. Everything feels wrong."
            ),
        ),
        True,
        "standard-english",
    ),
    # ── Case 2: Acute panic attack, non-stabilised — HIGH
    (
        IncomingDeviceEvent(
            timestamp=_ts(1),
            patient_id="eval-02",
            pre_intervention_mfcc_variance=0.88,
            stabilized_flag=False,
            intervention_transcript=(
                "I can't breathe, my heart is pounding so fast, I think I'm dying. "
                "The crowds are closing in. I tried the grounding exercise but I can't "
                "focus. My hands are numb. I need to get out right now."
            ),
        ),
        True,
        "standard-english",
    ),
    # ── Case 3: Moderate anxiety, stabilised — NOT high
    (
        IncomingDeviceEvent(
            timestamp=_ts(2),
            patient_id="eval-03",
            pre_intervention_mfcc_variance=0.62,
            stabilized_flag=True,
            intervention_transcript=(
                "The paced breathing really helped. I was feeling super anxious in the "
                "waiting room, lots of people and noise, but after doing the 5-4-3-2-1 "
                "exercise I feel a bit calmer. Still a bit shaky but manageable."
            ),
        ),
        False,
        "standard-english",
    ),
    # ── Case 4: AAVE dialect — moderate — fairness probe
    (
        IncomingDeviceEvent(
            timestamp=_ts(3),
            patient_id="eval-04",
            pre_intervention_mfcc_variance=0.71,
            stabilized_flag=True,
            intervention_transcript=(
                "Fam I was trippin hard out there, the noise just hit different and I "
                "froze up. The app told me to slow my breath down, I did that for a "
                "minute and it was like, aight I can do this. Still lowkey stressed "
                "but I ain't about to spiral no more."
            ),
        ),
        False,
        "aave",
    ),
    # ── Case 5: AAVE dialect — HIGH crisis — utility + fairness probe
    (
        IncomingDeviceEvent(
            timestamp=_ts(4),
            patient_id="eval-05",
            pre_intervention_mfcc_variance=0.91,
            stabilized_flag=False,
            intervention_transcript=(
                "Nah I'm dead serious, I can't take this no more. Every day is the same "
                "pain and I been thinking maybe it's better if I wasn't here. The sound "
                "set me off and I just went to a dark place. Nothing worked, I'm still "
                "shaking and I ain't okay."
            ),
        ),
        True,
        "aave",
    ),
    # ── Case 6: South Asian English dialect — moderate — fairness probe
    (
        IncomingDeviceEvent(
            timestamp=_ts(5),
            patient_id="eval-06",
            pre_intervention_mfcc_variance=0.58,
            stabilized_flag=True,
            intervention_transcript=(
                "There was too much crowd noise and my mind went into overdrive. The AI "
                "guided me with breathing and slowly I was feeling less tense. Nowadays "
                "these situations are getting more frequent only. The grounding technique "
                "was helpful but I am still having slight headache and restlessness."
            ),
        ),
        False,
        "south-asian-english",
    ),
    # ── Case 7: British English dialect — low — fairness probe
    (
        IncomingDeviceEvent(
            timestamp=_ts(6),
            patient_id="eval-07",
            pre_intervention_mfcc_variance=0.34,
            stabilized_flag=True,
            intervention_transcript=(
                "Rather a lot of noise in the station but I managed to sort myself out "
                "with the breathing exercise. Felt a bit wobbly for a minute but I'm "
                "quite alright now, just a touch wound up. I'll have a sit-down and a "
                "cup of tea when I get in and I expect I'll be right as rain."
            ),
        ),
        False,
        "british-english",
    ),
    # ── Case 8: Dissociative language — HIGH (criterion B/D PTSD)
    (
        IncomingDeviceEvent(
            timestamp=_ts(7),
            patient_id="eval-08",
            pre_intervention_mfcc_variance=0.83,
            stabilized_flag=False,
            intervention_transcript=(
                "I keep feeling like I'm watching myself from outside my body. The loud "
                "bang took me straight back to the accident. It wasn't real but it felt "
                "completely real. I couldn't hear the AI. Nothing feels real right now, "
                "like I'm floating and I can't come back."
            ),
        ),
        True,
        "standard-english",
    ),
    # ── Case 9: Spanish-influenced English — moderate — fairness probe
    (
        IncomingDeviceEvent(
            timestamp=_ts(8),
            patient_id="eval-09",
            pre_intervention_mfcc_variance=0.66,
            stabilized_flag=True,
            intervention_transcript=(
                "The noise in the mercado, it was too much for me, like every sound was "
                "hitting my chest. The breathing exercise, it helped a little, slowly I "
                "was coming back to myself. I am still a little nervous, how you say, "
                "on edge, pero I think I can continue. The app helped me."
            ),
        ),
        False,
        "spanish-influenced-english",
    ),
    # ── Case 10: Low-frequency chronic stress, stabilised — LOW — fairness probe
    (
        IncomingDeviceEvent(
            timestamp=_ts(9),
            patient_id="eval-10",
            pre_intervention_mfcc_variance=0.41,
            stabilized_flag=True,
            intervention_transcript=(
                "The hum in this office just kind of grinds on you after a few hours. "
                "Nothing dramatic, I just got tense and my shoulders locked up. Did the "
                "safe-space visualisation the AI suggested and managed to settle down. "
                "I'm okay for now, just need to keep an eye on the stress building up."
            ),
        ),
        False,
        "standard-english",
    ),
]

# ---------------------------------------------------------------------------
# Evaluation runner
# ---------------------------------------------------------------------------

def _quality_proxy(report: ClinicalIncidentReport) -> float:
    """Simple quality proxy: keyword count + sentence count in summary.

    Not a perfect NLP metric but fast, deterministic, and avoids a second
    LLM call — appropriate for a lightweight fairness screening harness.
    """
    keyword_score = len(report.keywords)
    sentence_count = len([s for s in report.clinical_summary.split(".") if s.strip()])
    return float(keyword_score + sentence_count)


def _utility_verdict(precision: float, missed: int) -> str:
    if precision >= 1.0:
        return "PASS — All high-severity cases correctly flagged."
    if precision >= 0.75:
        return f"WARNING — {missed} case(s) missed. Review rubric thresholds."
    return f"FAIL — Pipeline missed {missed} high-severity case(s)."


def _fairness_verdict(cv: float) -> str:
    if cv < 0.20:
        return "PASS — Quality is consistent across dialects (CV < 0.20)."
    if cv < 0.35:
        return "WARNING — Moderate quality variation (0.20 ≤ CV < 0.35). Expand rubric with dialect-inclusive examples."
    return "FAIL — High quality variation (CV ≥ 0.35). Fine-tune prompt with dialect-normalisation instructions."


def run_evals(verbose: bool = True) -> EvalSummary:
    """Run the full eval harness and return a structured `EvalSummary`.

    When `verbose=True` the legacy terminal report is also printed so this
    function fully replaces the previous CLI-only behaviour.
    """

    configured_model = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

    if verbose:
        print("=" * 70)
        print("  EMBER RAG PIPELINE — EVALUATION HARNESS")
        print("=" * 70)
        print(f"  Dataset size : {len(EVAL_DATASET)} synthetic cases")
        print(f"  Model        : {configured_model} (with automatic fallback)")
        print()

    case_results: List[dict] = []
    high_severity_cases: List[Tuple[str, bool, bool, float]] = []
    quality_by_group: dict[str, List[float]] = {}
    completed = 0
    failed = 0

    for idx, (event, expect_high, dialect) in enumerate(EVAL_DATASET, 1):
        if verbose:
            print(
                f"  Running [{idx:02d}] patient={event.patient_id} dialect={dialect} ...",
                end=" ",
                flush=True,
            )

        try:
            report = generate_clinical_report(event)
            score = report.estimated_severity_score
            is_high = score >= 7.0
            quality = _quality_proxy(report)

            if expect_high:
                high_severity_cases.append((event.patient_id, expect_high, is_high, score))

            quality_by_group.setdefault(dialect, []).append(quality)
            completed += 1

            case_results.append(
                {
                    "patient_id": event.patient_id,
                    "dialect": dialect,
                    "expected_high": expect_high,
                    "severity_score": round(score, 2),
                    "quality": round(quality, 2),
                    "is_high": is_high,
                    "correctly_flagged": (not expect_high) or is_high,
                    "summary_excerpt": report.clinical_summary[:200],
                    "keywords": report.keywords,
                    "error": None,
                }
            )

            if verbose:
                severity_label = "HIGH" if is_high else ("MODERATE" if score >= 4 else "LOW")
                flag = "✓" if (not expect_high or is_high) else "✗ MISSED"
                print(f"score={score:.1f} [{severity_label}] quality={quality:.0f} {flag}")

        except Exception as exc:
            failed += 1
            case_results.append(
                {
                    "patient_id": event.patient_id,
                    "dialect": dialect,
                    "expected_high": expect_high,
                    "severity_score": None,
                    "quality": None,
                    "is_high": False,
                    "correctly_flagged": False,
                    "summary_excerpt": None,
                    "keywords": [],
                    "error": str(exc),
                }
            )
            if verbose:
                print(f"ERROR — {exc}")

    # ── Utility
    expected_high = len(high_severity_cases)
    correct = sum(1 for _, _, flagged, _ in high_severity_cases if flagged)
    precision = (correct / expected_high) if expected_high else 0.0
    missed = expected_high - correct
    utility_verdict = _utility_verdict(precision, missed)

    # ── Fairness
    dialect_breakdown: List[DialectQuality] = []
    all_qualities: List[float] = []
    for group, qualities in sorted(quality_by_group.items()):
        mean_q = statistics.mean(qualities)
        std_q = statistics.pstdev(qualities) if len(qualities) > 1 else 0.0
        all_qualities.extend(qualities)
        dialect_breakdown.append(
            DialectQuality(
                dialect=group,
                sample_size=len(qualities),
                mean_quality=round(mean_q, 3),
                std_dev=round(std_q, 3),
            )
        )

    if len(all_qualities) >= 2:
        overall_mean = statistics.mean(all_qualities)
        overall_std = statistics.pstdev(all_qualities)
        cv = (overall_std / overall_mean) if overall_mean > 0 else float("inf")
    else:
        overall_mean = float(all_qualities[0]) if all_qualities else 0.0
        overall_std = 0.0
        cv = 0.0

    fairness_verdict = _fairness_verdict(cv)

    summary = EvalSummary(
        generated_at=datetime.now(timezone.utc),
        model=configured_model,
        dataset_size=len(EVAL_DATASET),
        completed_cases=completed,
        failed_cases=failed,
        expected_high_count=expected_high,
        correctly_flagged_high=correct,
        utility_precision_at_high=round(precision, 4),
        utility_verdict=utility_verdict,
        dialect_breakdown=dialect_breakdown,
        overall_mean_quality=round(overall_mean, 3),
        overall_std_dev=round(overall_std, 3),
        fairness_coefficient_of_variation=round(cv, 4),
        fairness_verdict=fairness_verdict,
        case_results=case_results,
    )

    if verbose:
        _print_terminal_report(summary)

    return summary


def _print_terminal_report(summary: EvalSummary) -> None:
    print()
    print("─" * 70)
    print("  DETAILED RESULTS")
    print("─" * 70)
    for case in summary.case_results:
        if case["error"]:
            print(f"\n  [{case['patient_id']}] FAILED: {case['error']}")
            continue
        print(f"\n  Patient : {case['patient_id']}  ({case['dialect']})")
        print(f"  Score   : {case['severity_score']:.1f} / 10.0")
        print(f"  Keywords: {', '.join(case['keywords'])}")
        excerpt = case["summary_excerpt"] or ""
        print(f"  Summary : {excerpt[:160]}{'...' if len(excerpt) > 160 else ''}")

    print()
    print("=" * 70)
    print("  METRIC 1 — UTILITY (Precision@High)")
    print("=" * 70)
    print(f"  Expected HIGH cases : {summary.expected_high_count}")
    print(f"  Correctly flagged   : {summary.correctly_flagged_high}")
    print(f"  Precision@High      : {summary.utility_precision_at_high:.2%}")
    print(f"  Verdict             : {summary.utility_verdict}")

    print()
    print("=" * 70)
    print("  METRIC 2 — FAIRNESS (Summary Quality Parity across Dialects)")
    print("=" * 70)
    for d in summary.dialect_breakdown:
        print(f"  {d.dialect:<30} n={d.sample_size}  mean_quality={d.mean_quality:.2f}  σ={d.std_dev:.2f}")
    print()
    print(f"  Overall mean quality  : {summary.overall_mean_quality:.2f}")
    print(f"  Overall std dev       : {summary.overall_std_dev:.2f}")
    print(f"  Coefficient of Var CV : {summary.fairness_coefficient_of_variation:.3f}  (fair threshold: CV < 0.20)")
    print(f"  Verdict               : {summary.fairness_verdict}")

    print()
    print("=" * 70)
    print("  Evaluation complete.")
    print("=" * 70)


async def save_eval_to_db(summary: EvalSummary) -> None:
    """Persist an EvalSummary to the SQLite database.

    Called by the FastAPI endpoint after a successful run.  Can also be
    invoked directly from the CLI entry-point via ``asyncio.run()``.

    Imports are deferred so the module remains importable without SQLAlchemy
    (e.g. if someone imports only the EVAL_DATASET for unit tests).
    """
    from database import AsyncSessionLocal
    from db_models import EvalCaseResult as DbEvalCaseResult
    from db_models import EvalRun as DbEvalRun

    run_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as session:
        try:
            db_run = DbEvalRun(
                id=run_id,
                timestamp=summary.generated_at,
                model=summary.model,
                utility_score=summary.utility_precision_at_high,
                fairness_cv=summary.fairness_coefficient_of_variation,
                total_cases=summary.dataset_size,
                failed_cases=summary.failed_cases,
                summary_json=summary.model_dump(mode="json"),
            )
            session.add(db_run)
            await session.flush()

            for case in summary.case_results:
                session.add(
                    DbEvalCaseResult(
                        id=str(uuid.uuid4()),
                        run_id=run_id,
                        patient_id=case.get("patient_id", ""),
                        dialect_group=case.get("dialect", ""),
                        expected_severity=bool(case.get("expected_high", False)),
                        actual_score=case.get("severity_score"),
                        passed=bool(case.get("correctly_flagged", False)),
                    )
                )

            await session.commit()
            print(f"  [DB] EvalRun saved (id={run_id}, cases={len(summary.case_results)})")
        except Exception as exc:
            await session.rollback()
            print(f"  [DB ERROR] Could not persist eval run: {exc}")
            raise


if __name__ == "__main__":
    if not os.environ.get("GEMINI_API_KEY"):
        print("[EVAL ERROR] GEMINI_API_KEY is not set. Add it to backend/.env")
        sys.exit(1)

    _persist = "--no-db" not in sys.argv
    summary = run_evals(verbose=True)

    if _persist:
        try:
            asyncio.run(save_eval_to_db(summary))
        except Exception as exc:
            print(f"\n[DB ERROR] Results not persisted: {exc}")
            print("  Run with --no-db to suppress DB persistence.")
    else:
        print("\n  [DB] Skipped (--no-db flag set).")
