"""Command-line interface for vinculum-ai."""

from __future__ import annotations

import argparse
import sys


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="vinculum-ai",
        description=(
            "Ask questions about Vinculum VCL, grounded in the official documentation.\n\n"
            "By default the tool auto-downloads a pre-built embedding index from the\n"
            "latest Vinculum release and caches it in ~/.cache/vinculum-ai/.\n"
            "You can also point it at a local docs directory or a pre-built index."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
index sources (mutually exclusive; default is auto-download):
  --docs DIR        Build index from local .md files (e.g. a checkout of tsarna/vinculum)
  --index PATH      Use a pre-built FAISS index directory (skips all embedding)
  (default)         Auto-download from tsarna/vinculum GitHub releases

examples:
  # Quickstart — auto-downloads the latest Vinculum index:
  export ANTHROPIC_API_KEY=sk-ant-...
  python -m vinculum_ai "How do I define a subscription?"

  # Pin to a specific Vinculum release:
  python -m vinculum_ai --docs-version v1.2.0 "How do I define a subscription?"

  # Debug a specific VCL file:
  python -m vinculum_ai --vcl myconfig.vcl "Why is this subscription broken?"

  # Build index from a local docs checkout (and save it):
  python -m vinculum_ai --docs ~/src/vinculum/doc --save-index ./vcl-index

  # Use a pre-built index:
  python -m vinculum_ai --index ./vcl-index "Show me a cron block example"

  # Use Groq for fast inference (OpenAI-compatible):
  export OPENAI_API_KEY=gsk_...
  python -m vinculum_ai \\
    --provider openai \\
    --base-url https://api.groq.com/openai/v1 \\
    --model llama-3.3-70b-versatile \\
    "How do I wire up a metric?"
""",
    )

    # ── Question ──────────────────────────────────────────────────────────────
    p.add_argument(
        "question",
        nargs="?",
        help=(
            "Question to answer about Vinculum VCL. "
            "Omit when using --save-index without a question."
        ),
    )

    # ── Index source (mutually exclusive) ─────────────────────────────────────
    src = p.add_mutually_exclusive_group()
    src.add_argument(
        "--docs",
        metavar="DIR",
        help="Build index from local .md files in this directory.",
    )
    src.add_argument(
        "--index",
        metavar="PATH",
        help="Load a pre-built FAISS index directory (index.faiss + index.pkl).",
    )

    # ── Auto-download controls ────────────────────────────────────────────────
    p.add_argument(
        "--docs-version",
        metavar="VERSION",
        default="latest",
        dest="docs_version",
        help=(
            'Vinculum release version to download the index for. '
            'Use "latest" (default) or a tag like "v1.2.0".'
        ),
    )
    p.add_argument(
        "--refresh-index",
        action="store_true",
        dest="refresh_index",
        help="Force re-download of the cached index, even if already present.",
    )

    # ── Index build / save ────────────────────────────────────────────────────
    p.add_argument(
        "--save-index",
        metavar="PATH",
        dest="save_index",
        help=(
            "When building from --docs, also save the FAISS index to this path "
            "for reuse with --index or for distribution in a release."
        ),
    )

    # ── VCL context ───────────────────────────────────────────────────────────
    p.add_argument(
        "--vcl",
        metavar="FILE",
        help="VCL file to include as additional context (e.g. a config you're debugging).",
    )

    # ── LLM provider ──────────────────────────────────────────────────────────
    p.add_argument(
        "--provider",
        choices=["auto", "anthropic", "openai"],
        default="auto",
        help=(
            "Chat LLM provider. 'auto' prefers Anthropic if ANTHROPIC_API_KEY is set, "
            "else OpenAI. (default: auto)"
        ),
    )
    p.add_argument(
        "--model",
        metavar="NAME",
        help=(
            "Model name override. "
            "Defaults: claude-sonnet-4-6 (Anthropic), gpt-4o-mini (OpenAI). "
            "For Groq: llama-3.3-70b-versatile."
        ),
    )
    p.add_argument(
        "--base-url",
        metavar="URL",
        dest="base_url",
        help=(
            "Override the LLM API endpoint. Use for OpenAI-compatible providers:\n"
            "  Groq:       https://api.groq.com/openai/v1\n"
            "  Together:   https://api.together.xyz/v1\n"
            "  Mistral:    https://api.mistral.ai/v1"
        ),
    )

    # ── Embedding provider ────────────────────────────────────────────────────
    p.add_argument(
        "--embedding-provider",
        choices=["fastembed", "openai"],
        default="fastembed",
        dest="embedding_provider",
        help=(
            "Embedding backend. Must match the provider used when the index was built. "
            "'fastembed' runs locally (~50 MB model, no API key). "
            "'openai' uses text-embedding-3-small via OPENAI_API_KEY. "
            "(default: fastembed)"
        ),
    )

    # ── Retrieval ─────────────────────────────────────────────────────────────
    p.add_argument(
        "--top-k",
        type=int,
        default=5,
        metavar="N",
        dest="top_k",
        help="Number of doc chunks to retrieve as context. (default: 5)",
    )

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # ── Validate argument combinations ────────────────────────────────────────
    if args.save_index and not args.docs:
        parser.error("--save-index requires --docs (nothing to build from).")

    if not args.question and not (args.docs and args.save_index):
        parser.error(
            "A question is required unless you are only building an index "
            "(--docs DIR --save-index PATH)."
        )

    if args.refresh_index and (args.docs or args.index):
        parser.error("--refresh-index only applies to auto-downloaded indexes.")

    if args.docs_version != "latest" and (args.docs or args.index):
        parser.error("--docs-version only applies to auto-downloaded indexes.")

    # ── Lazy imports — keeps --help instant ───────────────────────────────────
    from vinculum_ai.rag import build_index, load_docs, load_index, make_embeddings, stream_answer

    try:
        # ── Step 1: Get embeddings ─────────────────────────────────────────────
        # fastembed prints a progress bar to stderr on first download; that's fine.
        embeddings = make_embeddings(args.embedding_provider)

        # ── Step 2: Resolve the vector store ──────────────────────────────────
        if args.index:
            print(f"Loading index from {args.index}…", file=sys.stderr)
            store = load_index(args.index, embeddings)

        elif args.docs:
            print(f"Loading docs from {args.docs}…", file=sys.stderr)
            docs = load_docs(args.docs)
            store = build_index(docs, embeddings, save_path=args.save_index)

        else:
            # Auto-download
            from vinculum_ai.index import ensure_index
            index_path = ensure_index(args.docs_version, refresh=args.refresh_index)
            store = load_index(str(index_path), embeddings)

        # ── Step 3: Answer (if a question was provided) ───────────────────────
        if not args.question:
            # --docs + --save-index only — index has been built and saved, done.
            return

        print(file=sys.stderr)  # blank line before answer
        first = True
        for chunk in stream_answer(
            args.question,
            store=store,
            vcl_path=args.vcl,
            provider=args.provider,
            model=args.model,
            base_url=args.base_url,
            top_k=args.top_k,
        ):
            if first:
                print()  # blank line before first token on stdout
                first = False
            print(chunk, end="", flush=True)

        print("\n")  # trailing newline

    except (ValueError, EnvironmentError, RuntimeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[interrupted]", file=sys.stderr)
        sys.exit(130)
