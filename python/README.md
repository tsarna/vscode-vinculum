# vinculum-ai

A RAG-powered CLI for answering questions about [Vinculum](https://github.com/tsarna/vinculum) VCL configurations, grounded in the official documentation.

```
$ python -m vinculum_ai "How do I define a subscription?"

Subscriptions are defined with a `subscription` block. Each subscription
specifies a bus to listen on and a handler to call for each message:

    subscription my_sub {
      bus     = bus.events
      handler = handle_event
    }
…
```

## How it works

Unlike the VS Code extension (which injects the full documentation into every request), vinculum-ai uses **RAG — Retrieval-Augmented Generation**:

1. The documentation is split into small chunks and embedded into a vector index
2. When you ask a question, the question is also embedded
3. The **k most similar doc chunks** are retrieved (semantic search)
4. Only those chunks are sent to the LLM as context

This means the LLM sees focused, relevant documentation rather than everything at once — and the index can be pre-built and shipped so you never wait for embedding.

## Prerequisites

- Python 3.10+
- An API key for at least one LLM provider:
  - `ANTHROPIC_API_KEY` — for Claude (default if set)
  - `OPENAI_API_KEY` — for OpenAI or any OpenAI-compatible provider (Groq, Together AI, Mistral, …)

## Installation

```bash
cd python/
pip install -r requirements.txt
```

## Quickstart

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Auto-downloads the pre-built index from the latest Vinculum release (~300 KB):
python -m vinculum_ai "How do I define a subscription?"

# Ask about a specific VCL file you're debugging:
python -m vinculum_ai --vcl myconfig.vcl "Why is this subscription broken?"
```

The downloaded index is cached at `~/.cache/vinculum-ai/index/latest/` — subsequent queries skip the download entirely.

## Usage

```
python -m vinculum_ai [options] "question"
```

### Index sources

By default the tool auto-downloads the pre-built index from the latest Vinculum release. You can override this:

| Flag | Effect |
|---|---|
| *(default)* | Auto-download from `tsarna/vinculum` latest release |
| `--docs-version v1.2.0` | Download index for a specific Vinculum release |
| `--refresh-index` | Force re-download even if a cached copy exists |
| `--docs DIR` | Build index from local `.md` files (e.g. a dev checkout) |
| `--index PATH` | Load a pre-built index directory directly |

### Building and saving a local index

```bash
# Build from a local docs checkout and save for reuse:
python -m vinculum_ai --docs ~/src/vinculum/doc --save-index ./vcl-index

# Use the saved index later (instant startup, no embedding):
python -m vinculum_ai --index ./vcl-index "question"
```

### LLM providers

| Provider | Default model | Set |
|---|---|---|
| Anthropic | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-4o-mini` | `OPENAI_API_KEY` |
| Groq | *(specify --model)* | `OPENAI_API_KEY=<groq key>` + `--base-url` |
| Any OpenAI-compatible | *(specify --model)* | `OPENAI_API_KEY=<their key>` + `--base-url` |

`--provider auto` (default) picks Anthropic if `ANTHROPIC_API_KEY` is set, otherwise OpenAI.

```bash
# Groq (fast inference):
export OPENAI_API_KEY=gsk_...
python -m vinculum_ai \
  --provider openai \
  --base-url https://api.groq.com/openai/v1 \
  --model llama-3.3-70b-versatile \
  "How do I wire up a metric?"
```

### All options

```
positional:
  question              Question to answer (omit when only building an index)

index source (mutually exclusive):
  --docs DIR            Build index from local .md files
  --index PATH          Load a pre-built FAISS index directory

auto-download:
  --docs-version VER    Vinculum release version ("latest" or "v1.2.0")
  --refresh-index       Force re-download of the cached index

index build:
  --save-index PATH     Save the built index to PATH (requires --docs)

context:
  --vcl FILE            VCL file to include as additional context

LLM:
  --provider            anthropic | openai | auto (default: auto)
  --model NAME          Override model name
  --base-url URL        Override LLM API endpoint (for OpenAI-compatible providers)

embedding:
  --embedding-provider  fastembed | openai (default: fastembed)
                        Must match the provider used when the index was built.

retrieval:
  --top-k N             Doc chunks to retrieve as context (default: 5)
```

## LangChain concepts

This tool is built on [LangChain](https://python.langchain.com/). Here's what each component does:

| Concept | Used in | What it does |
|---|---|---|
| **Document** | `rag.py` | A `(text, metadata)` pair — one per `.md` file, then split into chunks |
| **RecursiveCharacterTextSplitter** | `rag.py` | Splits on `\n\n` → `\n` → space to keep chunks semantically coherent |
| **FastEmbedEmbeddings** | `rag.py` | Runs a local ONNX model to convert text → float[]; no API key needed |
| **FAISS** | `rag.py` | Stores all embedding vectors; `save_local()` / `load_local()` for persistence |
| **Retriever** | `rag.py` | `store.as_retriever(k=5)` — returns the top-5 most similar chunks for a query |
| **LCEL** | `rag.py` | `chain = passthrough \| prompt \| llm \| parser` — Unix-pipe-style composition |

The LCEL chain in full:

```
{"question": "…", "vcl_section": "…"}
      │
RunnablePassthrough.assign(context=retrieved_chunks)
      │  adds "context" to the dict; other keys pass through
      ▼
ChatPromptTemplate
      │  fills system + human templates
      ▼
LLM (Anthropic / OpenAI / Groq / …)
      │  streams tokens
      ▼
StrOutputParser
      extracts plain text
```

## Generating the index for a Vinculum release

The pre-built index is generated from the `doc/` directory of the `tsarna/vinculum` repo as part of its release CI. See [`scripts/build_index.py`](https://github.com/tsarna/vinculum/blob/main/scripts/build_index.py) in that repo.

To build one locally (e.g. against a development branch):

```bash
python -m vinculum_ai \
  --docs ~/src/vinculum/doc \
  --save-index ./vcl-index

# Package it the same way CI does:
tar -czf vinculum-index.tar.gz -C vcl-index .
```

The resulting archive is ~300 KB for the current Vinculum doc set.

## Relationship to the VS Code extension

The VS Code extension (`vscode-vinculum`) has a built-in AI assistant that also answers VCL questions. The two tools are complementary:

| | VS Code extension | vinculum-ai CLI |
|---|---|---|
| Interface | Webview chat panel | Terminal |
| Docs source | Fetched from GitHub (cached 24h) | Pre-built vector index |
| Retrieval | Full docs in every prompt | RAG — only relevant chunks |
| Best for | Interactive questions while editing | Scripting, CI, quick lookups |
