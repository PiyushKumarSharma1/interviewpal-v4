import argparse

import torch
import torch.nn.functional as F

from model import MiniGPT


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


class LoadedTokenizer:
    def __init__(self, stoi, itos):
        self.stoi = stoi
        self.itos = {int(k): v for k, v in itos.items()} if isinstance(next(iter(itos.keys())), str) else itos
        self.vocab_size = len(self.stoi)

    def encode(self, s: str):
        return [self.stoi[c] for c in s if c in self.stoi]

    def decode(self, ids):
        return "".join(self.itos[int(i)] for i in ids)


@torch.no_grad()
def generate_with_controls(model, idx, max_new_tokens, temperature=0.8, top_k=12):
    for _ in range(max_new_tokens):
        idx_cond = idx[:, -model.block_size :]
        logits, _ = model(idx_cond)
        logits = logits[:, -1, :] / max(temperature, 1e-5)

        if top_k is not None:
            values, _ = torch.topk(logits, min(top_k, logits.size(-1)))
            cutoff = values[:, -1].unsqueeze(-1)
            logits = torch.where(logits < cutoff, torch.full_like(logits, float("-inf")), logits)

        probs = F.softmax(logits, dim=-1)
        next_idx = torch.multinomial(probs, num_samples=1)
        idx = torch.cat((idx, next_idx), dim=1)

    return idx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", default="Piyush")
    parser.add_argument("--max-new-tokens", type=int, default=120)
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=12)
    args = parser.parse_args()

    ckpt = torch.load("model.pt", map_location=DEVICE)

    model = MiniGPT(
        vocab_size=ckpt["vocab_size"],
        block_size=ckpt["block_size"],
        n_embd=96,
        num_heads=4,
        num_layers=3,
        dropout=0.1,
    ).to(DEVICE)

    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    tok = LoadedTokenizer(ckpt["stoi"], ckpt["itos"])
    encoded_prompt = tok.encode(args.prompt) or tok.encode("Piyush")
    context = torch.tensor([encoded_prompt], dtype=torch.long).to(DEVICE)
    output = generate_with_controls(
        model,
        context,
        max_new_tokens=args.max_new_tokens,
        temperature=args.temperature,
        top_k=args.top_k,
    )[0].tolist()
    print(tok.decode(output))


if __name__ == "__main__":
    main()

