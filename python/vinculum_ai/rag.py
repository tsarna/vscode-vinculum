"""
RAG pipeline for vinculum-ai.

LangChain concepts used here — a brief glossary:

  Document
    The atomic unit of content: (page_content: str, metadata: dict).
    We create one per .md file, then split them into smaller overlapping chunks.

  RecursiveCharacterTextSplitter
    Splits long Documents into overlapping chunks. Tries progressively smaller
    separators (paragraph break → line break → space) so each chunk stays
    semantically coherent — a whole paragraph rather than half a sentence.

  Embeddings
    Converts text → float[]. By default we use fastembed, which runs a small
    ONNX model locally with no API key. The embedding model choice is locked
    to whatever was used when the FAISS index was built — you cannot mix
    providers between build time and query time.

  FAISS
    Facebook AI Similarity Search. Stores all embedding vectors and supports
    fast nearest-neighbour lookup via dot product / cosine similarity.
    LangChain's FAISS wrapper adds save_local() / load_local() for persistence.

  Retriever
    A thin interface around a vector store: given a query string, embed it
    and return the top-k most similar Documents. Built via:
      store.as_retriever(search_kwargs={"k": 5})

  LCEL — LangChain Expression Language
    Composes Runnables with |, like Unix pipes:
      chain = step_a | step_b | step_c
    Each step can be .invoke()d or .stream()ed uniformly.
    RunnablePassthrough.assign(key=fn) enriches the running dict with a new
    key while keeping all existing keys intact.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Iterator

from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_text_splitters import RecursiveCharacterTextSplitter

if TYPE_CHECKING:
    from langchain_community.vectorstores import FAISS

# ── Prompt ────────────────────────────────────────────────────────────────────

_SYSTEM = """\
You are an AI assistant specializing in Vinculum Configuration Language (VCL).
VCL is a domain-specific configuration language built on top of HCL \
(HashiCorp Configuration Language), similar to how Terraform configuration \
files relate to HCL.

Here is relevant documentation retrieved for this question:
<context>
{context}
</context>
{vcl_section}
Answer questions about VCL, help debug configurations, and generate VCL code \
snippets. Be concise and practical. When showing VCL code, use proper HCL \
formatting.\
"""

# ── Document loading ──────────────────────────────────────────────────────────


def load_docs(docs_dir: str) -> list[Document]:
    """Load all .md files under docs_dir as LangChain Documents."""
    root = Path(docs_dir)
    if not root.is_dir():
        raise ValueError(f"--docs path is not a directory: {docs_dir}")

    docs = [
        Document(
            page_content=path.read_text(encoding="utf-8"),
            metadata={"source": str(path.relative_to(root))},
        )
        for path in sorted(root.rglob("*.md"))
    ]

    if not docs:
        raise ValueError(f"No .md files found in: {docs_dir}")

    return docs


# ── Embeddings ────────────────────────────────────────────────────────────────


def make_embeddings(embedding_provider: str = "fastembed"):
    """
    Return an Embeddings instance for the requested provider.

    IMPORTANT: The embedding model used when building the FAISS index must
    match the model used at query time. The index bundles vectors from a
    specific model — mixing providers produces nonsensical similarity scores.
    """
    if embedding_provider == "openai":
        from langchain_openai import OpenAIEmbeddings

        if not os.environ.get("OPENAI_API_KEY"):
            raise EnvironmentError(
                "--embedding-provider openai requires OPENAI_API_KEY.\n"
                "Set OPENAI_API_BASE to target a compatible provider "
                "(Together AI, Mistral, Voyage AI, etc.)."
            )
        # OPENAI_API_BASE / OPENAI_BASE_URL are picked up automatically by the
        # openai client, so no extra configuration is needed here.
        return OpenAIEmbeddings(model="text-embedding-3-small")

    # fastembed: downloads a small (~50 MB) ONNX model to ~/.cache/fastembed/
    # on first use, then runs entirely locally — no API key, no network calls.
    try:
        from langchain_community.embeddings import FastEmbedEmbeddings
    except ImportError as e:
        raise ImportError(
            "fastembed is not installed. Run:\n"
            "  pip install fastembed langchain-community"
        ) from e

    return FastEmbedEmbeddings(model_name="BAAI/bge-small-en-v1.5")


# ── LLM ───────────────────────────────────────────────────────────────────────


def make_llm(
    provider: str = "auto",
    model: str | None = None,
    base_url: str | None = None,
):
    """
    Return a streaming-capable chat LLM.

    provider="auto" inspects environment variables:
      ANTHROPIC_API_KEY → ChatAnthropic (claude-sonnet-4-6)
      OPENAI_API_KEY    → ChatOpenAI    (gpt-4o-mini)

    For OpenAI-compatible providers (Groq, Together AI, Mistral, etc.),
    use provider="openai" with --base-url pointing at their API endpoint.
    The OPENAI_API_KEY value is sent as the bearer token, so just set it
    to that provider's key.
    """
    if provider == "auto":
        if os.environ.get("ANTHROPIC_API_KEY"):
            provider = "anthropic"
        elif os.environ.get("OPENAI_API_KEY"):
            provider = "openai"
        else:
            raise EnvironmentError(
                "No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, "
                "or pass --provider explicitly."
            )

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise EnvironmentError(
                "--provider anthropic requires ANTHROPIC_API_KEY to be set."
            )
        return ChatAnthropic(model=model or "claude-sonnet-4-6")

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        if not os.environ.get("OPENAI_API_KEY"):
            raise EnvironmentError(
                "--provider openai requires OPENAI_API_KEY to be set.\n"
                "For Groq: set OPENAI_API_KEY to your Groq key and pass\n"
                "  --base-url https://api.groq.com/openai/v1"
            )
        kwargs: dict = {"model": model or "gpt-4o-mini"}
        if base_url:
            kwargs["base_url"] = base_url
        return ChatOpenAI(**kwargs)

    raise ValueError(
        f"Unknown provider: {provider!r}. Choose 'anthropic', 'openai', or 'auto'."
    )


# ── FAISS index ───────────────────────────────────────────────────────────────


def build_index(
    docs: list[Document],
    embeddings,
    save_path: str | None = None,
) -> "FAISS":
    """
    Split docs into chunks, embed them, and return a FAISS vector store.

    chunk_size=800 characters keeps each chunk small enough to be meaningful
    context without overwhelming the retriever. chunk_overlap=100 ensures that
    sentences near a split boundary appear in full in at least one chunk.

    If save_path is provided, the index is written to disk as two files:
      {save_path}/index.faiss  — binary vector index
      {save_path}/index.pkl    — pickled docstore (text + metadata)

    Load it later with load_index(save_path, embeddings).
    """
    from langchain_community.vectorstores import FAISS

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100,
        # Default separators: ["\n\n", "\n", " ", ""]
        # Tries paragraph breaks first, then line breaks, then words.
    )
    chunks = splitter.split_documents(docs)
    print(f"  Embedding {len(chunks)} chunks…", file=sys.stderr)

    store = FAISS.from_documents(chunks, embeddings)

    if save_path:
        store.save_local(save_path)
        print(f"  Saved to {save_path}", file=sys.stderr)

    return store


def load_index(index_path: str, embeddings) -> "FAISS":
    """
    Load a FAISS index from disk.

    The embeddings instance must use the same model that was used when the
    index was built — it is called at query time to embed each question.

    allow_dangerous_deserialization=True is required by LangChain because
    FAISS uses pickle for the docstore. Only load indexes from trusted sources.
    """
    from langchain_community.vectorstores import FAISS

    return FAISS.load_local(
        index_path,
        embeddings,
        allow_dangerous_deserialization=True,
    )


# ── LCEL chain ────────────────────────────────────────────────────────────────


def _format_docs(docs: list[Document]) -> str:
    """Join retrieved chunks into a single context string with clear boundaries."""
    return "\n\n---\n\n".join(
        f"[{d.metadata.get('source', '?')}]\n{d.page_content}" for d in docs
    )


def build_chain(retriever, llm):
    """
    Assemble the RAG chain with LCEL.

    Data flows left-to-right through | pipes:

      {"question": "…", "vcl_section": "…"}
            │
      RunnablePassthrough.assign(context=…)
            │  Adds "context" key = top-k retrieved doc chunks.
            │  Other keys pass through unchanged.
            ▼
      ChatPromptTemplate
            │  Renders system + human message templates.
            ▼
      llm
            │  Streams the response token by token.
            ▼
      StrOutputParser
            Extracts the plain text string from the message object.
    """
    prompt = ChatPromptTemplate.from_messages([
        ("system", _SYSTEM),
        ("human", "{question}"),
    ])

    return (
        RunnablePassthrough.assign(
            context=lambda x: _format_docs(retriever.invoke(x["question"]))
        )
        | prompt
        | llm
        | StrOutputParser()
    )


# ── Top-level streaming entry point ──────────────────────────────────────────


def stream_answer(
    question: str,
    *,
    store: "FAISS",
    vcl_path: str | None = None,
    provider: str = "auto",
    model: str | None = None,
    base_url: str | None = None,
    top_k: int = 5,
) -> Iterator[str]:
    """
    Build the RAG chain from a loaded FAISS store and yield answer tokens.

    The store must already be loaded (via build_index or load_index) with
    embeddings that match the model used at index-build time.
    """
    vcl_section = ""
    if vcl_path:
        vcl_text = Path(vcl_path).read_text(encoding="utf-8")
        vcl_section = (
            f"\nThe user has provided this VCL file for context:\n"
            f"<vcl_file>\n{vcl_text}\n</vcl_file>\n"
        )

    retriever = store.as_retriever(search_kwargs={"k": top_k})
    llm = make_llm(provider, model, base_url)
    chain = build_chain(retriever, llm)

    yield from chain.stream({"question": question, "vcl_section": vcl_section})
