import os

import torch
from torch.utils.data import DataLoader
from tqdm import tqdm

from dataset import CharDataset
from model import MiniGPT
from tokenizer import load_text


BATCH_SIZE = 32
BLOCK_SIZE = 64
MAX_ITERS = 1000
EVAL_INTERVAL = 100
LEARNING_RATE = 3e-4
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
CHECKPOINT_PATH = "model.pt"


def build_model(vocab_size: int):
    return MiniGPT(
        vocab_size=vocab_size,
        block_size=BLOCK_SIZE,
        n_embd=96,
        num_heads=4,
        num_layers=3,
        dropout=0.1,
    ).to(DEVICE)


def main():
    text = load_text("data/corpus.txt")
    dataset = CharDataset(text, block_size=BLOCK_SIZE)
    tokenizer = dataset.tokenizer
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

    model = build_model(tokenizer.vocab_size)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)

    start_step = 0

    if os.path.exists(CHECKPOINT_PATH):
        ckpt = torch.load(CHECKPOINT_PATH, map_location=DEVICE)
        if ckpt.get("vocab_size") == tokenizer.vocab_size:
            model.load_state_dict(ckpt["model_state_dict"])
            if "optimizer_state_dict" in ckpt:
                optimizer.load_state_dict(ckpt["optimizer_state_dict"])
            start_step = ckpt.get("step", 0)
            print(f"Resuming from checkpoint at step {start_step}")
        else:
            print("Checkpoint vocab size does not match current corpus. Starting fresh.")

    model.train()
    step = start_step
    target_step = start_step + MAX_ITERS
    progress = tqdm(total=MAX_ITERS)

    while step < target_step:
        for xb, yb in loader:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)

            _, loss = model(xb, yb)

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

            step += 1
            progress.update(1)

            if step % EVAL_INTERVAL == 0:
                print(f"step {step}: loss {loss.item():.4f}")

            if step >= target_step:
                break

    progress.close()

    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "step": step,
            "vocab_size": tokenizer.vocab_size,
            "stoi": tokenizer.stoi,
            "itos": tokenizer.itos,
            "block_size": BLOCK_SIZE,
        },
        CHECKPOINT_PATH,
    )
    print(f"Saved model to {CHECKPOINT_PATH} at step {step}")


if __name__ == "__main__":
    main()

