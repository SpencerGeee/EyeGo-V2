"""EyeGo Lottie generator — shape-only, 60 fps, premium easing.

Writes the JSON files to the directory given as argv[1].
Every brand-coloured shape lives in a layer named "accent" (and its fill /
stroke items are named "accent" too) so lottie-react-native's colorFilters
can re-tint per ride class at runtime.
"""
import json
import math
import os
import random
import sys

FR = 60
ACCENT = [0.294, 0.886, 0.467, 1]   # #4BE277
WHITE = [1, 1, 1, 1]
INK = [0.039, 0.039, 0.047, 1]      # #0A0A0C
GOLD = [1, 0.773, 0.239, 1]         # #FFC53D
SKY = [0.302, 0.545, 1, 1]          # #4D8BFF

# cubic-bezier easings (x1, y1, x2, y2)
OUT = (0.22, 1, 0.36, 1)        # emphasized decelerate
INOUT = (0.65, 0, 0.35, 1)
IN = (0.55, 0, 0.75, 0.2)
POP = (0.34, 1.56, 0.64, 1)     # gentle overshoot
LIN = (0, 0, 1, 1)


# ── animated property helpers ───────────────────────────────────────────────
def static(v):
    return {"a": 0, "k": v}


def anim(keys, dims):
    """keys: list of (frame, value, ease) — ease applies from this key to the next."""
    out = []
    for idx, (t, v, ease) in enumerate(keys):
        val = v if isinstance(v, list) else [v]
        k = {"t": t, "s": val}
        if idx < len(keys) - 1:
            x1, y1, x2, y2 = ease or OUT
            k["o"] = {"x": [x1] * dims, "y": [y1] * dims}
            k["i"] = {"x": [x2] * dims, "y": [y2] * dims}
        out.append(k)
    return {"a": 1, "k": out}


def prop(v, dims):
    if isinstance(v, dict):
        return v
    return static(v)


def tr(p=(0, 0), a=(0, 0), s=(100, 100), r=0, o=100):
    return {
        "ty": "tr",
        "p": p if isinstance(p, dict) else static(list(p)),
        "a": a if isinstance(a, dict) else static(list(a)),
        "s": s if isinstance(s, dict) else static(list(s)),
        "r": r if isinstance(r, dict) else static(r),
        "o": o if isinstance(o, dict) else static(o),
        "sk": static(0),
        "sa": static(0),
        "nm": "Transform",
    }


def ellipse(d, p=(0, 0)):
    return {"ty": "el", "nm": "Ellipse", "d": 1,
            "p": p if isinstance(p, dict) else static(list(p)),
            "s": d if isinstance(d, dict) else static([d, d])}


def rect(w, h, r, p=(0, 0)):
    return {"ty": "rc", "nm": "Rect", "d": 1,
            "p": p if isinstance(p, dict) else static(list(p)),
            "s": static([w, h]), "r": static(r)}


def path(points, closed=False, tangents=None):
    n = len(points)
    ins = [[0, 0]] * n
    outs = [[0, 0]] * n
    if tangents:
        ins, outs = tangents
    return {"ty": "sh", "nm": "Path", "d": 1,
            "ks": static({"i": ins, "o": outs, "v": [list(p) for p in points], "c": closed})}


def fill(color, name="fill", o=100):
    return {"ty": "fl", "nm": name, "c": static(color), "o": o if isinstance(o, dict) else static(o), "r": 1}


def stroke(color, w, name="stroke", o=100, dash=None):
    s = {"ty": "st", "nm": name, "c": static(color), "o": o if isinstance(o, dict) else static(o),
         "w": static(w), "lc": 2, "lj": 2, "ml": 4}
    if dash:
        s["d"] = [{"n": "d", "nm": "dash", "v": static(dash[0])},
                  {"n": "g", "nm": "gap", "v": static(dash[1])},
                  {"n": "o", "nm": "offset", "v": static(0)}]
    return s


def trim(end, start=None):
    return {"ty": "tm", "nm": "Trim", "s": start if start else static(0), "e": end, "o": static(0), "m": 1}


def group(items, transform=None, name="Group"):
    return {"ty": "gr", "nm": name, "it": items + [transform or tr()]}


def layer(name, shapes, op, p=(0, 0), s=(100, 100), r=0, o=100, ip=0, st=0, a=(0, 0)):
    def v3(v):
        if isinstance(v, dict):
            return v
        return static(list(v) + [0]) if len(v) == 2 else static(list(v))

    def s3(v):
        if isinstance(v, dict):
            return v
        return static(list(v) + [100])

    return {
        "ddd": 0, "ty": 4, "nm": name, "sr": 1, "ao": 0, "bm": 0,
        "ip": ip, "op": op, "st": st,
        "ks": {
            "o": o if isinstance(o, dict) else static(o),
            "r": r if isinstance(r, dict) else static(r),
            "p": v3(p),
            "a": v3(a),
            "s": s3(s),
        },
        "shapes": shapes,
    }


def comp(name, w, h, op, layers):
    for i, l in enumerate(layers, start=1):
        l["ind"] = i
    return {"v": "5.7.4", "fr": FR, "ip": 0, "op": op, "w": w, "h": h, "nm": name,
            "ddd": 0, "assets": [], "markers": [], "layers": layers}


def s3k(keys):
    """Scale keys (frame, pct, ease) -> 3D scale animation."""
    return anim([(t, [v, v, 100], e) for t, v, e in keys], 3)


def check_path(size):
    k = size / 100.0
    return path([(-22 * k, 2 * k), (-7 * k, 17 * k), (24 * k, -15 * k)])


# ── 1. searching radar (loop) ───────────────────────────────────────────────
def searching_radar():
    W = H = 400
    OP = 108
    cx, cy = W / 2, H / 2
    layers = []
    # Center: solid accent dot with a soft breathing halo.
    layers.append(layer("accent", [group([ellipse(22), fill(ACCENT, "accent")])], OP,
                        p=(cx, cy), s=s3k([(0, 100, INOUT), (54, 112, INOUT), (108, 100, None)])))
    layers.append(layer("accent", [group([ellipse(64), fill(ACCENT, "accent")])], OP, p=(cx, cy),
                        o=anim([(0, 22, INOUT), (54, 10, INOUT), (108, 22, None)], 1),
                        s=s3k([(0, 86, INOUT), (54, 112, INOUT), (108, 86, None)])))
    # A slow sweep arc, one revolution per loop (constant spin reads as radar).
    arc = group([ellipse(232), stroke(ACCENT, 3, "accent", o=55),
                 trim(static(17))])
    layers.append(layer("accent", [arc], OP, p=(cx, cy),
                        r=anim([(0, 0, LIN), (OP, 360, None)], 1)))
    # Three rings, 36 frames apart; each one is drawn by two layers so the
    # ring in flight at the loop seam continues across it seamlessly.
    life = OP

    def ring_layers(offset):
        def ring(st):
            # The delay is baked into the KEYFRAME times (no layer `st`, which
            # players disagree about), and the layer is visible only inside its
            # own flight, so it never idles at the centre.
            return layer("accent", [group([ellipse(360), stroke(ACCENT, 3, "accent")])], min(OP, st + life),
                         p=(cx, cy), ip=max(0, st),
                         s=s3k([(st, 6, (0.25, 0.5, 0.45, 1)), (st + life, 100, None)]),
                         o=anim([(st, 85, LIN), (st + life, 0, None)], 1))
        return [ring(offset)] + ([ring(offset - OP)] if offset > 0 else [])

    for off in (0, 36, 72):
        layers.extend(ring_layers(off))
    return comp("searching_radar", W, H, OP, layers)


# ── 2. bus found (one-shot) ─────────────────────────────────────────────────
def bus_found():
    W = H = 400
    OP = 72
    cx, cy = W / 2, H / 2
    layers = []
    # Sparks: 12 rounded bars, alternating accent / white, flying outward.
    for i in range(12):
        ang = i * 30
        col = ACCENT if i % 2 == 0 else WHITE
        name = "accent" if i % 2 == 0 else "spark"
        reach = 150 if i % 2 == 0 else 128
        bar = group([rect(16, 5, 2.5), fill(col, name)],
                    tr(p=anim([(8, [64, 0], OUT), (46, [reach, 0], None)], 2),
                       s=anim([(8, [100, 100], OUT), (46, [30, 100], None)], 2),
                       o=anim([(8, 0, OUT), (14, 100, IN), (46, 0, None)], 1)))
        layers.append(layer(name, [bar], OP, p=(cx, cy), r=ang))
    # Ripple ring.
    layers.append(layer("accent", [group([ellipse(150), stroke(ACCENT, 3, "accent")])], OP, p=(cx, cy),
                        s=s3k([(6, 70, OUT), (54, 165, None)]),
                        o=anim([(6, 0, OUT), (12, 70, IN), (54, 0, None)], 1)))
    # Check, drawn on.
    layers.append(layer("check", [group([check_path(150), stroke(INK, 11, "ink"),
                                         trim(anim([(16, 0, OUT), (40, 100, None)], 1))])], OP, p=(cx, cy)))
    # Solid disc pops in with a gentle overshoot and settles.
    layers.append(layer("accent", [group([ellipse(150), fill(ACCENT, "accent")])], OP, p=(cx, cy),
                        s=s3k([(0, 0, POP), (22, 100, None)])))
    return comp("bus_found", W, H, OP, layers)


# ── 3. seat booked confetti (one-shot) ──────────────────────────────────────
def seat_booked_confetti():
    W = H = 400
    OP = 84
    rnd = random.Random(7)
    layers = []
    palette = [(ACCENT, "accent"), (ACCENT, "accent"), (WHITE, "piece"), (GOLD, "piece"), (SKY, "piece")]
    for i in range(28):
        col, name = palette[i % len(palette)]
        ang = math.radians(rnd.uniform(-62, 62) - 90)
        speed = rnd.uniform(150, 250)
        apex = (200 + math.cos(ang) * speed, 330 + math.sin(ang) * speed)
        drift = rnd.uniform(-40, 40)
        end = (apex[0] + drift, 470)
        t_apex = rnd.randint(26, 36)
        shape = rect(rnd.choice([10, 14]), rnd.choice([5, 7]), 2) if i % 3 else ellipse(rnd.choice([8, 10]))
        spin = rnd.choice([-1, 1]) * rnd.uniform(240, 560)
        delay = rnd.randint(0, 6)
        layers.append(layer(name, [group([shape, fill(col, name)])], OP,
                            p=anim([(delay, [200, 330, 0], OUT), (t_apex + delay, [apex[0], apex[1], 0], IN),
                                    (OP, [end[0], end[1], 0], None)], 3),
                            r=anim([(delay, 0, OUT), (OP, spin, None)], 1),
                            o=anim([(delay, 0, OUT), (delay + 4, 100, LIN), (OP - 16, 100, IN), (OP, 0, None)], 1)))
    return comp("seat_booked_confetti", W, H, OP, layers)


# ── 4. boarded (one-shot) ───────────────────────────────────────────────────
def boarded():
    W = H = 300
    OP = 60
    cx, cy = W / 2, H / 2
    seat = group([
        rect(40, 74, 14, (-26, -14)),
        stroke(WHITE, 7, "ink-white"),
    ], tr(r=-6), "back")
    base = group([rect(84, 24, 10, (6, 34)), stroke(WHITE, 7, "ink-white")], name="base")
    legs = group([path([(-20, 46), (-24, 70)]), path([(32, 46), (36, 70)]), stroke(WHITE, 7, "ink-white")], name="legs")
    layers = []
    badge_check = group([check_path(56), stroke(INK, 6, "ink"), trim(anim([(30, 0, OUT), (46, 100, None)], 1))])
    layers.append(layer("badge-check", [badge_check], OP, p=(cx + 50, cy - 56)))
    layers.append(layer("accent", [group([ellipse(56), fill(ACCENT, "accent")])], OP, p=(cx + 50, cy - 56),
                        s=s3k([(20, 0, POP), (36, 100, None)])))
    layers.append(layer("seat", [seat, base, legs], OP, p=(cx - 6, cy + 6),
                        s=s3k([(0, 82, OUT), (20, 100, None)]),
                        o=anim([(0, 0, OUT), (12, 100, None)], 1)))
    return comp("boarded", W, H, OP, layers)


# ── 5. trip complete (one-shot) ─────────────────────────────────────────────
def trip_complete():
    W = H = 300
    OP = 66
    cx, cy = W / 2, H / 2
    layers = []
    layers.append(layer("accent", [group([ellipse(150), stroke(ACCENT, 2.5, "accent")])], OP, p=(cx, cy), ip=18,
                        s=s3k([(18, 100, OUT), (66, 175, None)]),
                        o=anim([(18, 70, OUT), (66, 0, None)], 1)))
    layers.append(layer("check", [group([check_path(130), stroke(INK, 10, "ink"),
                                         trim(anim([(20, 0, OUT), (44, 100, None)], 1))])], OP, p=(cx, cy)))
    layers.append(layer("accent", [group([ellipse(130), fill(ACCENT, "accent")])], OP, p=(cx, cy),
                        s=s3k([(0, 0, POP), (24, 100, None)])))
    return comp("trip_complete", W, H, OP, layers)


# ── 6. loading (loop) ───────────────────────────────────────────────────────
def loading():
    W = H = 120
    OP = 60
    layers = []
    for i in range(3):
        x = 60 + (i - 1) * 26
        t0 = i * 10
        y = anim([(t0, [x, 60, 0], INOUT), (t0 + 14, [x, 50, 0], INOUT), (t0 + 28, [x, 60, 0], LIN), (t0 + 60, [x, 60, 0], None)], 3)
        o = anim([(t0, 40, INOUT), (t0 + 14, 100, INOUT), (t0 + 28, 40, LIN), (t0 + 60, 40, None)], 1)

        def dot(st, y=y, o=o):
            return layer("accent", [group([ellipse(14), fill(ACCENT, "accent")])], OP, p=y, o=o, st=st)
        # Each wave (t0 .. t0+28) finishes inside the loop, so one copy is seamless.
        layers.append(dot(0))
    return comp("loading", W, H, OP, layers)


# ── 7. walk to stop (loop) ──────────────────────────────────────────────────
def walk_to_stop():
    W, H = 240, 80
    OP = 96
    layers = []
    xs = [22 + i * 24 for i in range(7)]
    for i, x in enumerate(xs):
        peak = 8 + i * 10
        s = s3k([(0, 100, INOUT), (peak - 8, 100, OUT), (peak, 150, INOUT), (peak + 14, 100, LIN), (OP, 100, None)])
        o_white = anim([(0, 28, INOUT), (peak - 8, 28, OUT), (peak, 0, INOUT), (peak + 14, 28, LIN), (OP, 28, None)], 1)
        o_acc = anim([(0, 0, INOUT), (peak - 8, 0, OUT), (peak, 100, INOUT), (peak + 14, 0, LIN), (OP, 0, None)], 1)
        layers.append(layer("accent", [group([ellipse(7), fill(ACCENT, "accent")])], OP, p=(x, 46), s=s, o=o_acc))
        layers.append(layer("dot", [group([ellipse(7), fill(WHITE, "dot")])], OP, p=(x, 46), s=s, o=o_white))
    # The pin at the end of the walk: a teardrop with a hole, bobbing once.
    pin_path = path(
        [(0, 18), (-11, 2), (0, -14), (11, 2)], closed=True,
        tangents=([[0, 0], [0, 9], [-6, 0], [0, -6]], [[0, 0], [0, -6], [6, 0], [0, 9]]),
    )
    pin = group([pin_path, fill(ACCENT, "accent")], name="pin")
    hole = group([ellipse(7, (0, -1)), fill(INK, "ink")], name="hole")
    layers.insert(0, layer("pin-hole", [hole], OP,
                           p=anim([(0, [212, 40, 0], INOUT), (76, [212, 40, 0], OUT), (84, [212, 33, 0], INOUT),
                                   (92, [212, 40, 0], LIN), (OP, [212, 40, 0], None)], 3)))
    layers.insert(1, layer("accent", [pin], OP,
                           p=anim([(0, [212, 40, 0], INOUT), (76, [212, 40, 0], OUT), (84, [212, 33, 0], INOUT),
                                   (92, [212, 40, 0], LIN), (OP, [212, 40, 0], None)], 3)))
    return comp("walk_to_stop", W, H, OP, layers)


# ── 8. ride card empty (loop) ───────────────────────────────────────────────
def ride_card_empty():
    W, H = 400, 300
    OP = 144
    layers = []
    # The bus breathes on its suspension; the road scrolls under it.
    bob = anim([(0, [200, 142, 0], INOUT), (36, [200, 139, 0], INOUT), (72, [200, 142, 0], INOUT),
                (108, [200, 139, 0], INOUT), (144, [200, 142, 0], None)], 3)
    body = group([rect(216, 96, 26), stroke(WHITE, 6, "ink-white", o=88)], name="body")
    wins = [group([rect(46, 28, 9, (x, -14)), stroke(WHITE, 4, "ink-white", o=55)], name="window") for x in (-66, -14)]
    windscreen = group([rect(36, 40, 10, (66, -8)), stroke(WHITE, 4, "ink-white", o=55)], name="windscreen")
    stripe = group([path([(-96, 22), (40, 22)]), stroke(ACCENT, 4, "accent", o=80)], name="stripe")
    layers.append(layer("bus", wins + [windscreen, body], OP, p=bob))
    layers.append(layer("accent", [stripe], OP, p=bob))
    light = group([ellipse(12, (100, 18)), fill(ACCENT, "accent")])
    layers.append(layer("accent", [light], OP, p=bob,
                        o=anim([(0, 100, INOUT), (72, 55, INOUT), (144, 100, None)], 1)))
    for wx in (-62, 62):
        wheel = group([ellipse(40), fill(INK, "ink"), stroke(WHITE, 6, "ink-white", o=88)], name="tyre")
        hub = group([ellipse(10), fill(WHITE, "hub", o=70)], name="hub")
        mark = group([ellipse(5, (0, -11)), fill(WHITE, "mark", o=80)], name="mark")
        layers.insert(0, layer("wheel", [mark, hub, wheel], OP, p=(200 + wx, 196),
                               r=anim([(0, 0, LIN), (OP, 720, None)], 1)))
    # Dashed road, one dash period (36) per loop — seamless.
    dashes = []
    for i in range(16):
        dashes.append(group([rect(20, 4, 2, (-288 + i * 36, 0)), fill(WHITE, "road")]))
    layers.append(layer("road", dashes, OP, o=30,
                        p=anim([(0, [200, 226, 0], LIN), (OP, [164, 226, 0], None)], 3)))
    # Speed lines behind the bus.
    for j, (y, ln) in enumerate([(116, 34), (140, 22), (164, 30)]):
        st = j * 16
        layers.append(layer("speed", [group([path([(0, 0), (ln, 0)]), stroke(WHITE, 3, "speed")])], OP,
                            p=anim([(st, [70, y, 0], OUT), (st + 48, [30, y, 0], None)], 3),
                            o=anim([(st, 0, OUT), (st + 12, 45, IN), (st + 48, 0, None)], 1)))
    return comp("ride_card_empty", W, H, OP, layers)


BUILDERS = [searching_radar, bus_found, seat_booked_confetti, boarded, trip_complete,
            loading, walk_to_stop, ride_card_empty]

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for b in BUILDERS:
        data = b()
        p = os.path.join(out, data["nm"] + ".json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f'{data["nm"]:<22} {data["w"]}x{data["h"]} {data["op"]}f {os.path.getsize(p) // 1024 + 1} KB')
