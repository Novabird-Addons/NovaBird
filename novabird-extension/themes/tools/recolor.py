#!/usr/bin/env python3
"""Farbumrechnung für Themes (OKLCH). Wird von den Bauskripten für NovaBird-Sand, -Cobalt und -Springlight genutzt.
  warm_light / warm_dark : bläulich getönte Grautöne -> warmes Grau (Akzentblau bleibt)
  Ersetzt #rrggbb und %23rrggbb (in data:-URLs) in beliebigem Text."""
import math, re

def _lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _gam(c): return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055

def hex2oklch(h):
    h = h.lstrip("#"); r, g, b = (_lin(int(h[i:i+2], 16) / 255) for i in (0, 2, 4))
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l, m, s = (x ** (1/3) for x in (l, m, s))
    L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s
    A = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s
    B = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360

def oklch2hex(L, C, H):
    for _ in range(30):                    # Chroma bis in den sRGB-Bereich zurücknehmen
        a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
        l = (L + 0.3963377774*a + 0.2158037573*b) ** 3
        m = (L - 0.1055613458*a - 0.0638541728*b) ** 3
        s = (L - 0.0894841775*a - 1.2914855480*b) ** 3
        r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
        g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
        bl = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
        if all(-0.0005 <= v <= 1.0005 for v in (r, g, bl)) or C < 1e-4: break
        C *= 0.93
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(_gam(max(0, min(1, v))) * 255))) for v in (r, g, bl))

def lum(h):
    h = h.lstrip("#"); r, g, b = (_lin(int(h[i:i+2], 16) / 255) for i in (0, 2, 4))
    return 0.2126*r + 0.7152*g + 0.0722*b
def contrast(a, b):
    x, y = lum(a) + 0.05, lum(b) + 0.05
    return max(x, y) / min(x, y)

HEX = re.compile(r"(#|%23)([0-9a-fA-F]{6})\b")
def apply(text, fn):
    def rep(m):
        new = fn(("#" + m.group(2)).lower())
        return m.group(1) + (new.lstrip("#") if new else m.group(2))
    return HEX.sub(rep, text)

def make_warm(dark, overrides):
    """Bläuliche Neutraltöne -> warmes Grau; Akzentblau und kräftige Töne bleiben. overrides: {hex: hex}"""
    def fn(h):
        if h in overrides: return overrides[h]
        L, C, H = hex2oklch(h)
        if h in ("#ffffff", "#000000"): return None
        tinted = C < 0.03 if dark else (C < 0.032 or (C < 0.056 and L < 0.7))
        if tinted and 190 < H < 300:
            C2 = (0.006 if L > 0.5 else 0.005) if not dark else 0.006
            return oklch2hex(L, C2, 82 if not dark else 70)
        return None
    return lambda t: apply(t, fn)

# ---------- Hell -> Dunkel (für Cobalt und Springlight) ----------
_ANCH = [(0.0, 0.96), (0.23, 0.93), (0.30, 0.90), (0.40, 0.82), (0.55, 0.72), (0.70, 0.62), (0.88, 0.30), (0.93, 0.25), (0.97, 0.21), (1.0, 0.18)]
def _pw(x, pts):
    for (a, b), (c, d) in zip(pts, pts[1:]):
        if a <= x <= c: return b + (d - b) * (x - a) / (c - a) if c > a else b
    return pts[-1][1]

def dark_hex(h, chroma_k, floor=0.0, base_hue=255):
    """Heller Farbwert -> passender dunkler (Neutral/Tönung umkehren, Akzent aufhellen, Auswahlblau abdunkeln)."""
    if h == "#000000": return None
    L, C, H = hex2oklch(h)
    if C < 0.025:                                                      # Flächen, Linien, Schrift
        L2 = _pw(L, _ANCH)
        return oklch2hex(L2, max(C * chroma_k, floor * (1.0 if L2 < 0.5 else 0.6)), base_hue if C < 0.012 else H)
    if 190 < H < 300 and L > 0.8 and C < 0.07:                      # Auswahl-/Weichblau -> dunkles Stahlblau
        return oklch2hex(0.30 + (1 - L) * 0.6, 0.06 * chroma_k + 0.012, H)
    if 190 < H < 300 and L <= 0.8 and C < 0.09:                      # getönte Mitteltöne / Symbole
        return oklch2hex(_pw(L, _ANCH), C * chroma_k, H)
    if C >= 0.09 and 190 < H < 300:                                   # Akzentblau (auch dunkle Link-Blautöne) aufhellen
        return oklch2hex(min(0.82, max(0.74, 0.74 + (0.55 - L) * 0.4)) if L < 0.6 else max(L, 0.74), C * 0.85, H)
    if C >= 0.04 and L > 0.9:                                          # helle Gelb-/Warnflächen
        return oklch2hex(0.27, 0.035, H)
    if C >= 0.04 and L < 0.55 and not (190 < H < 300):                 # dunkle Warn-/Textfarben
        return oklch2hex(0.80, C * 0.8, H)
    return None

def make_dark(chroma_k, surface_dark, text_on_accent, floor=0.0, base_hue=255):
    """Textumwandlung mit Kontext für Weiß: Schrift (color:) -> text_on_accent, color-mix mit Weiß -> surface_dark, sonst Fläche."""
    def conv(text):
        out = []
        for line in text.split("\n"):
            low = line.lower()
            is_text = re.search(r"(^|[;{\s])color\s*:", line) or "labelcolor" in low or "todaycolor" in low
            def rep(m):
                h = ("#" + m.group(2)).lower()
                if h == "#ffffff": new = surface_dark if "color-mix" in low else (text_on_accent if is_text else dark_hex(h, chroma_k, floor, base_hue))
                else: new = dark_hex(h, chroma_k, floor, base_hue)
                return m.group(1) + (new.lstrip("#") if new else m.group(2))
            line = HEX.sub(rep, line)
            line = re.sub(r"#fff\b(?![0-9a-fA-F])", surface_dark if "color-mix" in low else (text_on_accent if is_text else surface_dark), line, flags=re.I)
            out.append(line)
        return "\n".join(out)
    return conv
