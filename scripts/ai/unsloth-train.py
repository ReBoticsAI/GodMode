#!/usr/bin/env python3
"""Unsloth QLoRA trainer — reads JSON job spec from argv[1].

Job spec fields:
  adapterId, outputDir, baseModel, llamaCppDir, datasetPath,
  epochs, learningRate, loraRank

Dataset JSONL schema (one object per line):
  {"messages": [{"role": "user"|"assistant"|"system", "content": "..."}, ...]}
  OR {"instruction": "...", "input": "...", "output": "..."}

Stdout must include `progress=NN%` lines for the Bridge manager to track progress.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def log(msg: str) -> None:
    print(f"[train] {msg}", flush=True)


def fail(msg: str, code: int = 1) -> int:
    log(f"ERROR: {msg}")
    return code


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON on line {i}: {e}") from e
    if not rows:
        raise ValueError(f"No rows in dataset: {path}")
    return rows


def row_to_text(row: dict[str, Any], tokenizer) -> str:
    if "messages" in row:
        return tokenizer.apply_chat_template(
            row["messages"], tokenize=False, add_generation_prompt=False
        )
    instruction = str(row.get("instruction", ""))
    inp = str(row.get("input", ""))
    output = str(row.get("output", ""))
    if inp:
        user = f"{instruction}\n\n{inp}"
    else:
        user = instruction
    messages = [{"role": "user", "content": user}, {"role": "assistant", "content": output}]
    return tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=False
    )


def find_convert_script(llama_cpp_dir: Path) -> Path | None:
    candidates = [
        llama_cpp_dir / "convert_lora_to_gguf.py",
        llama_cpp_dir / "examples" / "convert_lora_to_gguf.py",
        llama_cpp_dir / "tools" / "convert_lora_to_gguf.py",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def run_convert(
    convert_script: Path,
    base_model: str,
    peft_dir: Path,
    out_file: Path,
) -> bool:
    cmd = [
        sys.executable,
        str(convert_script),
        str(peft_dir),
        "--outfile",
        str(out_file),
        "--outtype",
        "f16",
    ]
    if base_model:
        cmd.extend(["--base", base_model])
    log(f"Running: {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line.rstrip(), flush=True)
    code = proc.wait()
    if code != 0:
        log(f"convert_lora_to_gguf.py exited with code {code}")
        return False
    return out_file.is_file()


def main() -> int:
    if len(sys.argv) < 2:
        return fail("Usage: unsloth-train.py <job-spec.json>")

    spec_path = Path(sys.argv[1])
    if not spec_path.is_file():
        return fail(f"Spec file not found: {spec_path}")

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    adapter_id = str(spec.get("adapterId", "adapter"))
    out_dir = Path(spec.get("outputDir", "apps/bridge/data/ai/adapters"))
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{adapter_id}.gguf"

    base_model = str(spec.get("baseModel", "unsloth/gemma-3-4b-it"))
    llama_cpp_dir = Path(str(spec.get("llamaCppDir", Path.home() / "llama.cpp")))
    dataset_path = Path(str(spec.get("datasetPath", "")))
    epochs = int(spec.get("epochs", 3))
    learning_rate = float(spec.get("learningRate", 2e-4))
    lora_rank = int(spec.get("loraRank", 16))

    if not dataset_path.is_file():
        return fail(f"Dataset not found: {dataset_path}")

    log(f"Starting QLoRA job for {adapter_id}")
    log(f"Base model: {base_model}")
    log(f"Dataset: {dataset_path}")
    log(f"Epochs={epochs} lr={learning_rate} rank={lora_rank}")

    try:
        import torch
    except ImportError:
        return fail(
            "PyTorch not installed. Install training deps: pip install -r scripts/ai/requirements-train.txt"
        )

    if not torch.cuda.is_available():
        return fail(
            "CUDA not available. Unsloth QLoRA training requires an NVIDIA GPU with CUDA."
        )

    try:
        from unsloth import FastLanguageModel
        from trl import SFTTrainer
        from transformers import TrainingArguments
        from datasets import Dataset
    except ImportError as e:
        return fail(
            f"Missing training dependency ({e}). Run: pip install -r scripts/ai/requirements-train.txt"
        )

    log("Loading base model in 4-bit…")
    print("progress=5%", flush=True)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=2048,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=lora_rank,
        lora_alpha=lora_rank * 2,
        lora_dropout=0,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        use_gradient_checkpointing="unsloth",
    )

    log("Building dataset…")
    print("progress=10%", flush=True)
    raw_rows = load_jsonl(dataset_path)
    texts = [row_to_text(r, tokenizer) for r in raw_rows]
    dataset = Dataset.from_dict({"text": texts})

    total_steps = max(1, len(texts) * epochs)
    log(f"Training on {len(texts)} examples, ~{total_steps} steps")

    class ProgressCallback:
        def __init__(self) -> None:
            self.last_pct = 10

        def on_log(self, args, state, control, logs=None, **kwargs):
            if not state.max_steps:
                return
            pct = 10 + int(80 * state.global_step / state.max_steps)
            pct = min(pct, 90)
            if pct > self.last_pct:
                self.last_pct = pct
                print(f"progress={pct}%", flush=True)
            if logs and "loss" in logs:
                log(f"step {state.global_step} loss={logs['loss']:.4f}")

    from transformers import TrainerCallback

    class _Cb(TrainerCallback, ProgressCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            ProgressCallback.on_log(self, args, state, control, logs, **kwargs)

    training_args = TrainingArguments(
        output_dir=str(out_dir / f".train-{adapter_id}"),
        num_train_epochs=epochs,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        learning_rate=learning_rate,
        logging_steps=1,
        save_strategy="no",
        report_to="none",
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=2048,
        args=training_args,
        callbacks=[_Cb()],
    )

    log("Training…")
    print("progress=15%", flush=True)
    trainer.train()
    print("progress=90%", flush=True)

    peft_dir = Path(tempfile.mkdtemp(prefix=f"lora-{adapter_id}-"))
    log(f"Saving PEFT adapter to {peft_dir}")
    model.save_pretrained(str(peft_dir))
    tokenizer.save_pretrained(str(peft_dir))

    convert_script = find_convert_script(llama_cpp_dir)
    if not convert_script:
        return fail(
            f"convert_lora_to_gguf.py not found under {llama_cpp_dir}. "
            f"Set LLAMA_CPP_DIR or install llama.cpp. PEFT saved at {peft_dir}"
        )

    log("Converting PEFT adapter to GGUF…")
    if not run_convert(convert_script, base_model, peft_dir, out_file):
        return fail(
            f"GGUF conversion failed. PEFT adapter kept at {peft_dir}"
        )

    log(f"Done — wrote {out_file}")
    print("progress=100%", flush=True)
    print(json.dumps({"ok": True, "path": str(out_file)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
