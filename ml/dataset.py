import torch
from torch.utils.data import Dataset


class CharTokenizer:
    def __init__(self, text: str):
        chars = sorted(set(text))
        self.stoi = {ch: idx for idx, ch in enumerate(chars)}
        self.itos = {idx: ch for ch, idx in self.stoi.items()}
        self.vocab_size = len(self.stoi)

    def encode(self, text: str):
        return [self.stoi[ch] for ch in text if ch in self.stoi]

    def decode(self, indices):
        return "".join(self.itos[int(index)] for index in indices)


class CharDataset(Dataset):
    def __init__(self, text: str, block_size: int):
        self.text = text
        self.block_size = block_size
        self.tokenizer = CharTokenizer(text)
        self.data = torch.tensor(self.tokenizer.encode(text), dtype=torch.long)

    def __len__(self):
        return max(1, len(self.data) - self.block_size)

    def __getitem__(self, index):
        x = self.data[index : index + self.block_size]
        y = self.data[index + 1 : index + self.block_size + 1]
        return x, y

