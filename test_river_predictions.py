import math

WATER_SIZE = 160
half = 80
TEST_WORLD_Z = 20

def getRiverCenter(z):
    return math.sin(z * 0.02) * 50.0 + math.cos(z * 0.05) * 20.0

rX = getRiverCenter(TEST_WORLD_Z)
print(f"Prediction 1: At TEST_WORLD_Z ({TEST_WORLD_Z}), exactly where the dams are placed, the river center is actually {rX:.2f}.")

print(f"Prediction 2: Our dams are hardcoded from x=-20 to x=20.")
if (20 < rX - 10):
    print("Result: The entire dam completely misses the river and sits uselessly on the dry bank!")
else:
    print("Result: The dam blocks the river.")

injectZ = TEST_WORLD_Z - half + 10
injectX = getRiverCenter(injectZ)
print(f"\nPrediction 3: We inject water at World Z {injectZ}. The river center there is {injectX:.2f}.")
print(f"The water flows from {injectX:.2f} carving diagonally towards {rX:.2f}.")

print("\nConclusion: All three scenarios look identical because the water perfectly bypasses the structures in all scenarios. The log and mud in scenario C are also magically placed at x=0, totally missing the water.")
