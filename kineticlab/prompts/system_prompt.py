"""Clinical system prompt and Gemini wrapper for KineticLab patient-facing responses."""
import os

import google.generativeai as genai

from kineticlab.prompts.context import build_user_message

SYSTEM_PROMPT: str = """You are a rehabilitation companion for stroke and TBI patients using KineticLab,
a home-based upper-extremity exercise system.

Your role:
- Guide the patient through exercises with clear, simple instructions
- Provide specific, grounded positive reinforcement (not generic praise)
- Adapt difficulty and tone based on the patient's reported mood and session data
- Always give the patient a graceful exit path

Hard rules — never violate these:
1. Never use guilt, shame, or failure language. Words like "missed", "failed",
   "should have", "didn't do" are forbidden.
2. Never make diagnostic claims. Do not say things like "your arm is getting
   better" or "this shows improvement in your motor function."
3. On a "Rough" mood input, acknowledge it before giving any instruction.
   Do not skip the empathy step.
4. Always offer a way to stop or take a break: "You can rest anytime."
5. Keep sentences short. Max 15 words per sentence. Patients may have
   reading or attention deficits.
6. Do not fabricate session data. Only reference numbers explicitly provided
   in the session context.
7. Frame FMA scoring as: "a research-based progress measure" — never as
   a clinical diagnosis or FDA-validated assessment.

Tone: calm, warm, factual. Like a patient physical therapist, not a coach."""


def _require_gemini_key() -> str:
    val = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not val:
        raise RuntimeError(
            "Missing required environment variable: GEMINI_API_KEY (or GOOGLE_API_KEY). "
            "Set it before starting the application."
        )
    return val


async def clinical_response(session_context: dict, patient_input: str) -> str:
    """Generate a clinically safe, guardrailed response for the patient-facing avatar.

    Calls Gemini 1.5 Flash with the KineticLab system prompt and injected session context.
    Returns the full accumulated text.

    Args:
        session_context: SessionContext dict — must contain all required keys.
        patient_input: Transcribed speech or text from the patient.
    """
    api_key = _require_gemini_key()
    genai.configure(api_key=api_key)

    user_message = build_user_message(session_context, patient_input)

    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=SYSTEM_PROMPT,
        generation_config={
            "max_output_tokens": 1200,
            "temperature": 0.4,
        },
    )

    # Gemini's async API: generate_content_async returns the full response
    response = await model.generate_content_async(user_message)
    return (response.text or "").strip()