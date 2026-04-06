import math

size = 160
half = 80
TEST_WORLD_Z = -100

originX = 0
originZ = TEST_WORLD_Z

offsetsA = {}
for x in range(-20, 21):
    offsetsA[f"{x},{TEST_WORLD_Z}"] = 6
    offsetsA[f"{x},{TEST_WORLD_Z+1}"] = 6

coloredPixels = 0

hasOffsets = len(offsetsA) > 1

for i in range(size * size):
    x = i % size
    z = i // size
    wx = originX - half + x
    wz = originZ - half + z
    
    h = 0
    if hasOffsets:
        x0 = math.floor(wx); x1 = x0 + 1
        z0 = math.floor(wz); z1 = z0 + 1
        tx = wx - x0; tz = wz - z0
        
        v00 = offsetsA.get(f"{x0},{z0}", 0)
        v10 = offsetsA.get(f"{x1},{z0}", 0)
        v01 = offsetsA.get(f"{x0},{z1}", 0)
        v11 = offsetsA.get(f"{x1},{z1}", 0)
        
        nx0 = v00 * (1 - tx) + v10 * tx
        nx1 = v01 * (1 - tx) + v11 * tx
        
        h += nx0 * (1 - tz) + nx1 * tz
        
    diff = h - 0
    if diff > 0.5:
        coloredPixels += 1

print(f"Colored pixels in Dam A: {coloredPixels}")
