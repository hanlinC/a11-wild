# Pixel tools

The server's picture tools, as one Python AWS Lambda container. The API sends a job; the function reads pictures from
the private picture store, writes the new picture and a result there, and can reach nothing else.

| Tool | Script | When to use it |
| --- | --- | --- |
| `skeleton` | `product_lock.py` | Before every draft of a product with a pack photo: the real pack on a blank canvas, so the model keeps its shape. |
| `reprint` | `product_lock.py` | After a render made from a plan skeleton: puts the real print back where the model smeared it. |
| `swap` | `product_lock.py` | To repair a picked draft or a final: replaces the drawn pack with the real one. |
| `pack_check` | `pack_check.py` | On every draft and final: is the pack as tall and as wide as the real pack (2%)? |
| `cap_check` | `cap_check.py` | On every draft and final of a bottle or jar: does the cap sit on the centre of the body (1%)? |
| `photo_finish` | `photo_finish.py` | On every final: the real-camera finish, the same for the same seed. |
| `food_crop` | `food_crop.py` | On every picture with food: the food beside the brand's own photo, to judge D2. |

The four scripts come from a11-adgen and keep their command lines, so each still runs alone.

Test: `python3 -m unittest discover -s services/pixels/tests` (needs `pip install -r services/pixels/requirements.txt`).
