"""Phase W4 campaign order: 3 sizes x 2 variants x 6 repetitions, shuffled with a
seeded Mersenne Twister (Python random.Random). Usage: make-plan.py <seed> > plan.txt"""
import random, sys
seed = int(sys.argv[1])
runs = [(f"{v}-k{k}-{i}", v, k) for k in (2, 4, 8) for v in ("base", "ws") for i in range(1, 7)]
random.Random(seed).shuffle(runs)
for label, v, k in runs:
    print(label, v, k)
