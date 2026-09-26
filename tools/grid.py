import sys
from PIL import Image
pre = sys.argv[1] if len(sys.argv) > 1 else '/tmp/m'; n = int(sys.argv[2]) if len(sys.argv) > 2 else 4
ims = [Image.open(f'{pre}_{i}.png') for i in range(n)]
w, h = ims[0].size; cols = 2; rows = (n + 1) // 2
c = Image.new('RGB', (w * cols, h * rows))
for i, im in enumerate(ims): c.paste(im, ((i % cols) * w, (i // cols) * h))
c.save(f'{pre}_grid.jpg', quality=85); print(f'{pre}_grid.jpg')
