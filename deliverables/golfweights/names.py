"""Clean product names from golfweights.co.uk slugs / derived keywords."""
import json, re

PRODUCTS = json.load(open("products.json"))

# Tokens to drop entirely when building a name from a slug
STOP = {
    "aftermarket", "golf", "weights", "weight", "kit", "kits", "club", "clubs",
    "quality", "for", "and", "the", "of", "copy", "pcs", "in", "head", "heads",
    "wrench", "series", "collection", "sleeve", "adapter", "shaft", "adapters",
    "xx", "piece", "uk", "stock",
    # cryptic internal SKU prefixes
    "wefd", "crf", "cszd", "cszf", "cwap", "cwemd", "cwesz", "cbl", "hnm", "mz",
    "pxgg", "png", "png410", "png425f", "png430", "pngirn", "sc", "tms", "tmst2",
    "tmex", "tmm4", "tmm6", "tmr", "tmsf", "tmsx", "tmts", "tti3", "tts1",
    "titleistts3",
}
# numeric noise: bare 1 / 2 (pack counts) are dropped; years kept
DROP_NUM = {"1", "2"}

CASE = {
    "taylormade": "TaylorMade", "talyormade": "TaylorMade", "callaway": "Callaway",
    "titleist": "Titleist", "ping": "Ping", "cobra": "Cobra", "cobta": "Cobra",
    "srixon": "Srixon", "srizon": "Srixon", "mizuno": "Mizuno", "odyssey": "Odyssey",
    "pxg": "PXG", "honma": "Honma", "wilson": "Wilson", "lab": "LAB",
    "scotty": "Scotty", "cameron": "Cameron", "toulon": "Toulon",
    "ls": "LS", "lst": "LST", "sft": "SFT", "sf": "SF", "hl": "HL", "hd": "HD",
    "xb": "XB", "xd": "XD", "og": "OG", "rh": "RH", "lh": "LH", "tp": "TP",
    "gtx": "GTX", "sim": "SIM", "sim2": "SIM2", "brnr": "BRNR", "ds": "DS",
    "sz": "SZ", "optm": "OPTM", "udi": "UDI", "fcg": "FCG", "fsg": "FSG",
    "gs": "GS", "tr20": "TR20", "zx": "ZX", "zxi": "ZXi", "zx5": "ZX5",
    "zx7": "ZX7", "mki": "MkI", "mkii": "MkII", "ii": "II", "ai": "Ai",
    "gen2": "Gen 2", "gen4": "Gen 4", "gen5": "Gen 5", "gen6": "Gen 6",
    "xgen4": "XGen 4", "stg": "ST-G", "stx": "ST-X", "stz": "ST-Z",
    "st": "ST", "b21": "B21", "xr16": "XR16", "b60": "B60", "zb": "ZB",
    "5k": "5K", "qi35": "Qi35", "qi4d": "Qi4D", "qi": "Qi", "v2": "V2",
    "t15": "T15", "t20": "T20", "t25": "T25", "ts1": "TS1", "ts2": "TS2",
    "ts3": "TS3", "ts4": "TS4", "tsi2": "TSi2", "tsi3": "TSi3", "tsi4": "TSi4",
    "tsr1": "TSR1", "tsr2": "TSR2", "tsr4": "TSR4", "gt2": "GT2", "gt3": "GT3",
    "gt4": "GT4", "gts2": "GTS2", "gts3": "GTS3", "gts4": "GTS4",
    "surefit": "SureFit", "ltdx": "LTDx", "tldx": "LTDx", "radspeed": "Radspeed",
    "darkspeed": "Darkspeed", "aerojet": "Aerojet", "speedzone": "Speedzone",
    "paradym": "Paradym", "mavrik": "Mavrik", "crusier": "Cruiser",
    "cruiser": "Cruiser", "myspider": "MySpider", "hydroblast": "Hydroblast",
    "golo": "GOLO", "anser": "Anser", "craz": "Craz", "e": "E",
    "0811": "0811", "0311": "0311", "0317": "0317", "0211": "0211",
    "0341": "0341",
}

def grams_from_slug(slug):
    s = slug.replace("/products/", "")
    m = re.search(r"(\d+(?:-\d+)?)g?-(\d+)g(?:\b|-|$)", s)
    if not m:
        return None
    lo, hi = m.group(1), m.group(2)
    if "-" in lo:  # e.g. 2-5g-18g -> 2.5g
        lo = lo.replace("-", ".")
    return f"{lo}g–{hi}g"

def adapter_spec(slug, club):
    s = slug
    tips = []
    for t in ("0-335", "0-350", "0-370"):
        if t in s:
            tips.append("." + t.split("-")[1])
    hand = "RH/LH" if ("rh-lh" in s or ("-rh" in s and "-lh" in s)) else \
           ("LH" if "-lh" in s else ("RH" if "-rh" in s else ""))
    clubs = [c for c, w in [("driver", "Driver"), ("fairway", "Fairway"), ("hybrid", "Hybrid")] if c in s]
    club_txt = {"driver": "Driver", "fairway": "Fairway", "hybrid": "Hybrid"}.get(club or "", "")
    if clubs:
        words = {"driver": "Driver", "fairway": "Fairway", "hybrid": "Hybrid"}
        names = [words[c] for c in clubs]
        club_txt = names[0] if len(names) == 1 else " & ".join([", ".join(names[:-1]), names[-1]]) if len(names) > 2 else " & ".join(names)
    parts = [p for p in ["/".join(tips), hand, club_txt] if p]
    return " ".join(parts)

def auto_name(url):
    slug = url.replace("/products/", "")
    slug = re.sub(r"(\d+(?:-\d+)?)g?-(\d+)g(-|$)", r"\3", slug)  # strip gram range
    slug = re.sub(r"0-3(35|50|70)", "", slug)  # strip tip sizes
    toks = [t for t in slug.split("-") if t]
    out = []
    for t in toks:
        if t in STOP or t in DROP_NUM:
            continue
        out.append(CASE.get(t, t.capitalize()))
    name = " ".join(out)
    # de-dupe immediate repeats ("Cameron Cameron")
    name = re.sub(r"\b(\w+)( \1\b)+", r"\1", name)
    return name

OVERRIDES = {
    "/products/cobra-optm-aftermarket-golf-shaft-adapter-0-335-lh-driver": "Cobra OPTM",
    "/products/cobra-optm-aftermarket-golf-shaft-adapter-0-335-rh-driver": "Cobra OPTM",
    "/products/cobra-optm-aftermarket-golf-shaft-adapter-0-335-rh-fairway": "Cobra OPTM",
    "/products/cobra-king-radspeed-xb-xd-driver-aftermarket-golf-weights-kit": "Cobra King Radspeed XB & XD Driver",
    "/products/scfb": "Scotty Cameron Fastback & Squareback Putter",
    "/products/cszd-cszf-aftermarket-golf-weights-wrench-for-cobta-sz-speedzone-drivers-fairway-woods-hybrids-4g-14g": "Cobra SZ Speedzone Driver, Fairway & Hybrid",
    "/products/copy-of-crf-aftermarket-golf-weights-wrench-for-cobra-king-radspeed-xb-xd-drivers-4g-14g": "Cobra King Radspeed XB & XD Driver",
    "/products/quality-aftermarket-driver-weight-for-cobra-king-radspeed-xb-xd-drivers": "Cobra King Radspeed XB & XD Driver Single Weight",
    "/products/quality-aftermarket-heel-weight-for-talyormade-sim2-sim2-max-and-sim2-max-d-drivers": "TaylorMade SIM2, SIM2 Max & Max D Driver Heel",
    "/products/tms-aftermarket-weight-for-taylormade-stealth-stealth-hd-and-stealth-plus-driver-fairway-woods-and-hybrids": "TaylorMade Stealth, Stealth HD & Stealth Plus",
    "/products/tmst2-taylormade-stealth-2-plus-drivers-and-hybrid-aftermarket-golf-weights-2g-15g": "TaylorMade Stealth 2 Plus Driver & Hybrid",
    "/products/taylormade-2016-m2-driver-aftermarket-golf-weights": "TaylorMade M2 Driver (2016)",
    "/products/taylormade-m2-d-type-driver-aftermarket-golf-weights": "TaylorMade M2 D-Type Driver",
    "/products/taylormade-m1-driver-2016-2017-aftermarket-golf-club-head-weights-5g-22g": "TaylorMade M1 Driver (2016–2017)",
    "/products/taylormade-brnr-mini-driver-1-2-aftermarket-golf-club-weights-2g-17g": "TaylorMade BRNR Mini Driver",
    "/products/taylormade-r7-quad-mini-driver-1-2-pcs-aftermarket-golf-club-weights": "TaylorMade R7 Quad Mini Driver",
    "/products/taylormade-r7-quad-mini-driver-1-2-pcs-aftermarket-golf-club-weight-kit": "TaylorMade R7 Quad Mini Driver",
    "/products/taylormade-qi-10-aftermarket-max-ls-hl-golf-club-driver-fairway-hybrid-weights-2-17g": "TaylorMade Qi10 Max, LS & HL Driver, Fairway & Hybrid",
    "/products/taylormade-qi-10-aftermarket-max-ls-hl-golf-club-driver-fairway-hybrid-weights-kit": "TaylorMade Qi10 Max, LS & HL Driver, Fairway & Hybrid",
    "/products/taylormade-tp-reserve-spider-gtx-max-putters-aftermarket-golf-weights-5g-20g": "TaylorMade TP Reserve & Spider GTX Max Putter",
    "/products/taylormade-putter-tp-collection-tp-silver-tp-patina-tp-black-copper-tp-red-tp-white-spider-mini-fcg-truss-putter-aftermarket-golf-weights-kit": "TaylorMade TP Collection, Spider Mini, FCG & Truss Putter",
    "/products/putter-weights-for-taylormade-tp-collection-spider-mini-fsg-and-truss-putters-5g-10g-15g-20g-and-wrench": "TaylorMade TP Collection, Spider Mini, FSG & Truss Putter",
    "/products/taylormade-qi-35-driver-aftermarket-weights-kit": "TaylorMade Qi35 Driver",
    "/products/taylormade-qi-35-fairway-hybrid-aftermarket-weights-kit": "TaylorMade Qi35 Fairway & Hybrid",
    "/products/taylormade-qi-35-aftermarket-weights": "TaylorMade Qi35 Driver",
    "/products/taylormade-qi-35-fairway-hybrid-aftermarket-weights": "TaylorMade Qi35 Fairway & Hybrid",
    "/products/taylormade-qi4d": "TaylorMade Qi4D Driver",
    "/products/taylormade-qi4d-driver-fairway-hybrid-aftermarket-golf-weights-kit": "TaylorMade Qi4D Driver, Fairway & Hybrid",
    "/products/taylormade-sim-driver-aftermarket-golf-back-slider-weights-4g-21g": "TaylorMade SIM Driver Back-Slider",
    "/products/tmsf-aftermarket-head-weight-for-taylormade-sim-titanium-fairway-wood-and-sim-udi-utility-iron": "TaylorMade SIM Titanium Fairway & SIM UDI Utility Iron",
    "/products/tmr-aftermarket-golf-weights-wrench-for-taylormade-r1-r5-r7-r9-r11-driver-fairway-woods-1g-20g": "TaylorMade R1, R5, R7, R9 & R11 Driver & Fairway",
    "/products/tmsx-aftermarket-weight-for-taylormade-spider-x-and-myspider-x-putter-series": "TaylorMade Spider X & MySpider X Putter",
    "/products/tmts-aftermarket-weights-for-taylormade-spider-tour-putter": "TaylorMade Spider Tour Putter Single Weight",
    "/products/tmex-aftermarket-golf-weights-wrench-for-taylormade-spider-ex-putter-series-4g-18g": "TaylorMade Spider EX Putter",
    "/products/taylormade-stealth-2-stealth-2-plus-stealth-2-hd-driver-hybrid-aftermarket-golf-weights-kit": "TaylorMade Stealth 2, Stealth 2 Plus & Stealth 2 HD",
    "/products/taylormade-burner-mini-driver-1-2-pcs-aftermarket-golf-club-weights-kit": "TaylorMade Burner Mini Driver",
    "/products/aftermarket-wrench-for-taylormade-tp-collection": "TaylorMade TP Collection Putter Wrench",
    "/products/taylormade-hybrid-aftermarket-golf-shaft-adapter-0-370-rh": "TaylorMade",
    "/products/odyssey-black-stroke-lab-series-white-hot-og-series-ten-series-o-works-putters-aftermarket-golf-weights-kit": "Odyssey Black, Stroke Lab, White Hot OG, Ten & O-Works Putter",
    "/products/odyssey-stroke-lab-series-white-hot-og-series-ten-series-o-works-putters-aftermarket-golf-weights-kit": "Odyssey Stroke Lab, White Hot OG, Ten & O-Works Putter",
    "/products/odyssey-stroke-lab-series-white-hot-og-series-ten-series-o-works-putters-aftermarket-golf-weights-copy": "Odyssey Stroke Lab, White Hot OG, Ten & O-Works Putter Single Weights",
    "/products/quality-aftermarket-weight-for-odyssey-stroke-lab-series-and-white-hot-series-putters": "Odyssey Stroke Lab & White Hot Putter Single Weight",
    "/products/odyssey-ai-one-ai-crusier-series-putter-aftermarket-golf-weights-5g-35g": "Odyssey Ai-ONE & Ai-ONE Cruiser Putter",
    "/products/odyssey-ai-one-ai-cruiser-series-putter-aftermarket-golf-weights-kit": "Odyssey Ai-ONE & Ai-ONE Cruiser Putter",
    "/products/odyssey-ai-one-milled-series-toulon-ai-golf-club-putter-head-aftermarket-weights-kit": "Odyssey Ai-ONE Milled & Toulon Ai Putter",
    "/products/odyssey-ai-one-milled-series-toulon-ai-golf-club-putter-head-aftermarket-weights-5-22g": "Odyssey Ai-ONE Milled & Toulon Ai Putter",
    "/products/odyssey-ai-dual-square-2-square-series-putter-aftermarket-golf-weights": "Odyssey Ai Dual & Square 2 Square Putter",
    "/products/odyssey-toulon-2022-series-golf-club-putter-head-aftermarket-weights": "Odyssey Toulon 2022 Putter",
    "/products/odyssey-toulon-2025-series-golf-club-putter-head-aftermarket-weights": "Odyssey Toulon 2025 Putter",
    "/products/odyssey-toulon-2025-collection-golf-club-putter-head-aftermarket-weights-kit": "Odyssey Toulon 2025 Putter",
    "/products/odyssey-tri-hot-5k-eleven-white-hot-versa-series-putter-aftermarket-golf-weights-kit": "Odyssey Tri-Hot 5K, Eleven, White Hot & Versa Putter",
    "/products/odyssey-tri-hot-2-square-series-putter-aftermarket-golf-weights": "Odyssey Tri-Hot & Square 2 Square Putter",
    "/products/odyssey-tri-hot-5k-series-putter-aftermarket-golf-weights": "Odyssey Tri-Hot 5K Putter",
    "/products/odyssey-tri-hot-5k-series-aftermarket-golf-wrench": "Odyssey Tri-Hot 5K Putter Wrench",
    "/products/sc-aftermarket-weights-for-scotty-cameron-putters": "Replacement Weights for Scotty Cameron Putters (All Models)",
    "/products/aftermarket-golf-weights-wrench-for-scotty-cameron-v2": "Scotty Cameron Putter Weights & Wrench (V2)",
    "/products/scotty-cameron-red-insert-phantom-x-newport-series-golo-series-futura-series-phantom-series-california-series-button-series-special-select-my-girl-putter-aftermarket-golf-weights-5g-45g": "Scotty Cameron Red Insert Putter (Phantom X, Newport, GOLO, Futura & More)",
    "/products/scotty-cameron-red-insert-fastback-squareback-putter-aftermarket-golf-weights": "Scotty Cameron Red Insert Fastback & Squareback Putter",
    "/products/scotty-cameron-putter-aftermarket-golf-weights-5g-45g-copy": "Scotty Cameron Putter",
    "/products/scotty-cameron-putter-aftermarket-golf-weights-5g-45g-copy-1": "Scotty Cameron Putter",
    "/products/scotty-cameron-putter-aftermarket-golf-weights-kit": "Scotty Cameron Putter",
    "/products/scotty-cameron-putter-aftermarket-golf-weights-kit-1": "Scotty Cameron Putter",
    "/products/scotty-cameron-putter-aftermarket-golf-weights-xx-piece-kit": "Scotty Cameron Putter Multi-Piece",
    "/products/scotty-cameron-circle-t-insert-putter-aftermarket-golf-weights-1": "Scotty Cameron Circle T Insert Putter",
    "/products/scotty-cameron-copper-putter-aftermarket-golf-weights-limited-edition": "Scotty Cameron Copper Putter (Limited Edition)",
    "/products/scotty-cameron-copper-putter-aftermarket-golf-weights-kit-limited-edition": "Scotty Cameron Copper Putter (Limited Edition)",
    "/products/scotty-cameron-gold-putter-aftermarket-golf-weights-limited-edition": "Scotty Cameron Gold Putter (Limited Edition)",
    "/products/scotty-cameron-rose-gold-putter-aftermarket-golf-weights-limited-edition": "Scotty Cameron Rose Gold Putter (Limited Edition)",
    "/products/scotty-cameron-rose-gold-putter-aftermarket-golf-weights-kit-limited-edition": "Scotty Cameron Rose Gold Putter (Limited Edition)",
    "/products/red-scotty-cameron-aftermarket-golf-club-wrench": "Scotty Cameron Putter Wrench (Red)",
    "/products/scotty-cameron-aftermarket-golf-club-wrench-in-black": "Scotty Cameron Putter Wrench (Black)",
    "/products/scotty-cameron-aftermarket-golf-club-wrench-in-green": "Scotty Cameron Putter Wrench (Green)",
    "/products/quality-aftermarket-putter-weight-for-ping-vault-2-0-putters-dale-answer-voss-b60-zb-piper-craz-e-h-stealth-ketsch": "Ping Vault 2.0 & Classic Putter (Dale Anser, Voss, B60, ZB, Piper & More)",
    "/products/png-aftermarket-golf-club-wrench-for-ping-vault-2-0-putters": "Ping Vault 2.0 Putter Wrench",
    "/products/ping-g30-ls-sf-tec-golf-club-driver-fairway-hybrid-aftermarket-head-weights-14-20g-uk-stock": "Ping G30 LS & SF Tec Driver, Fairway & Hybrid",
    "/products/ping-g400-lst-sft-max-aftermarket-driver-fairway-hybrid-golf-weights-10-21g": "Ping G400 LST, SFT & Max Driver, Fairway & Hybrid",
    "/products/png410-aftermarket-weights-for-ping-g410-driver-fairway-hybrid-woods": "Ping G410 Driver, Fairway & Hybrid",
    "/products/png425f-aftermarket-weight-for-ping-g425-fairway-woods-and-hybrid": "Ping G425 Fairway Wood & Hybrid",
    "/products/quality-aftermarket-sliding-head-weight-for-ping-g425-driver": "Ping G425 Driver Sliding",
    "/products/png430-aftermarket-weights-for-ping-g430-driver-fairway-woods-hybrids": "Ping G430 Driver, Fairway & Hybrid",
    "/products/pngirn-aftermarket-weights-for-ping-irons": "Replacement Weights for Ping Irons",
    "/products/ping-g425-max-lst-sft-drivers-aftermarket-golf-weights-kit": "Ping G425 Max, LST & SFT Driver",
    "/products/ping-g425-max-lst-fairway-woods-hybrid-aftermarket-golf-weights-kit": "Ping G425 Max & LST Fairway & Hybrid",
    "/products/ping-g400-g30-g-series-aftermarket-golf-sleeve-adapter-0-335-rh-lh-driver-fairway-woods": "Ping G400, G30 & G-Series",
    "/products/ping-g430-g425-g410-aftermarket-golf-shaft-adapter-0-335-lh-driver-fairway-woods": "Ping G430, G425 & G410",
    "/products/ping-g430-g425-g410-aftermarket-golf-shaft-adapter-0-370-rh-hybrid": "Ping G430, G425 & G410",
    "/products/ping-g430-g425-g410-aftermarket-golf-sleeve-adapter-0-335-rh-driver-fairway-woods": "Ping G430, G425 & G410",
    "/products/ping-g430-g425-g410-aftermarket-golf-sleeve-adapter-0-350-rh-driver-fairway-woods": "Ping G430, G425 & G410",
    "/products/wefd-aftermarket-golf-weights-and-wrench-for-callaway-epic-flash-sub-zero-and-epic-max-drivers-6g-23g": "Callaway Epic Flash, Sub Zero & Epic Max Driver",
    "/products/quality-aftermarket-weight-for-callaway-epic-speed-max-drivers-fairway-woods-and-apex-utility-hybrids": "Callaway Epic Speed & Max Driver, Fairway & Apex Utility Hybrid",
    "/products/quality-aftermarket-weight-for-callaway-mavrik-sub-zero-max-driver-fairway-woods": "Callaway Mavrik, Sub Zero & Max Driver & Fairway",
    "/products/callaway-mavrik-sub-zero-max-driver-fairway-woods-aftermarket-golf-weights-kit": "Callaway Mavrik, Sub Zero & Max Driver & Fairway",
    "/products/callaway-paradym-driver-and-fairway-wood-aftermarket-golf-weights-4g-18g": "Callaway Paradym Driver & Fairway Wood",
    "/products/callaway-paradym-ai-smoke-max-d-fast-triple-diamond-driver-aftermarket-golf-weights-2g-18g": "Callaway Paradym Ai Smoke Driver (Max D, Fast & Triple Diamond)",
    "/products/callaway-paradym-ai-smoke-max-d-fast-triple-diamond-driver-fairway-wood-aftermarket-golf-weights-copy": "Callaway Paradym Ai Smoke Fairway Wood (Max D, Fast & Triple Diamond)",
    "/products/callaway-paradym-x-triple-diamond-driver-aftermarket-golf-weights-copy": "Callaway Paradym X & Triple Diamond Driver",
    "/products/callaway-paradym-x-triple-diamond-fairway-woods-aftermarket-golf-weights-6g-14g": "Callaway Paradym X & Triple Diamond Fairway Wood",
    "/products/callaway-paradym-x-triple-diamond-hybrid-aftermarket-golf-weights-4g-12g": "Callaway Paradym X & Triple Diamond Hybrid",
    "/products/callaway-elyte-x-max-fast-driver-fairway-wood-aftermarket-golf-weights": "Callaway Elyte X, Max & Fast Driver & Fairway",
    "/products/callaway-elyte-x-max-fast-driver-fairway-wood-aftermarket-golf-weights-kit": "Callaway Elyte X, Max & Fast Driver & Fairway",
    "/products/callaway-elyte-paradym-rogue-epic-aftermarket-golf-shaft-adapter-0-335-lh-driver": "Callaway Elyte, Paradym, Rogue & Epic",
    "/products/callaway-elyte-paradym-rogue-epic-aftermarket-golf-shaft-adapter-0-335-lh-fairway": "Callaway Elyte, Paradym, Rogue & Epic",
    "/products/callaway-quantum-aftermarket-golf-shaft-adapter-0-335-0-370-rh-fairway-hybrid": "Callaway Quantum",
    "/products/aftermarket-golf-weights-and-wrench-for-callaway-epic-flash-rogue-st-sub-zero-drivers-fairway-woods-2g-18g": "Callaway Epic Flash & Rogue ST Sub Zero Driver & Fairway",
    "/products/quality-aftermarket-weight-for-callaway-big-bertha-b21-reva-driver-and-fairway-woods": "Callaway Big Bertha B21 & Reva Driver & Fairway",
    "/products/callaway-big-bertha-b21-reva-drivers-fairway-woods-aftermarket-golf-weights-kit": "Callaway Big Bertha B21 & Reva Driver & Fairway",
    "/products/quality-aftermarket-weight-for-callaway-great-big-bertha-alpha-and-xr16-drivers-and-fairway-woods": "Callaway Great Big Bertha, Alpha & XR16 Driver & Fairway",
    "/products/callaway-great-big-bertha-alpha-xr16-drivers-aftermarket-golf-weights-kit": "Callaway Great Big Bertha, Alpha & XR16 Driver",
    "/products/quality-aftermarket-weights-for-callaway-rogue-drivers-and-fairway-woods": "Callaway Rogue Driver & Fairway",
    "/products/callaway-rogue-drivers-fairway-woods-aftermarket-golf-weights-kit": "Callaway Rogue Driver & Fairway",
    "/products/cwemd-aftermarket-golf-weights-wrench-for-callaway-epic-max-and-max-ls-drivers-5g-22g": "Callaway Epic Max & Max LS Driver",
    "/products/cwesz-aftermarket-golf-weights-and-wrench-for-callaway-epic-sub-zero-fairway-woods-alpha-815-range-6g-16g": "Callaway Epic Sub Zero Fairway & Alpha 815",
    "/products/cwap-aftermarket-golf-weights-and-wrench-for-callaway-apex-hybrid-6g-18g": "Callaway Apex Hybrid",
    "/products/callaway-apex-utility-wood-24-aftermarket-golf-club-weights-4g-16g": "Callaway Apex Utility Wood (2024)",
    "/products/callaway-apex-utility-wood-2025-aftermarket-golf-club-weights": "Callaway Apex Utility Wood (2025)",
    "/products/callaway-aftermarket-golf-sleeve-adapter-0-350-rh-driver": "Callaway",
    "/products/callaway-aftermarket-golf-sleeve-adapter-0-350-rh-driver-1": "Callaway",
    "/products/cobra-darkspeed-aerojet-tldx-radspeed-aftermarket-golf-sleeve-adapter-0-335-rh-driver-fairway-woods": "Cobra Darkspeed, Aerojet, LTDx & Radspeed",
    "/products/cobra-darkspeed-aerojet-ltdx-radspeed-aftermarket-golf-shaft-adapter-0-335-lh-driver": "Cobra Darkspeed, Aerojet, LTDx & Radspeed",
    "/products/cobra-darkspeed-aerojet-ltdx-radspeed-aftermarket-golf-shaft-adapter-0-335-lh-fairway": "Cobra Darkspeed, Aerojet, LTDx & Radspeed",
    "/products/cobra-darkspeed-aerojet-ltdx-radspeed-aftermarket-golf-shaft-adapter-0-335-rh-fairway": "Cobra Darkspeed, Aerojet, LTDx & Radspeed",
    "/products/cobra-darkspeed-ls-max-x-ls-golf-club-driver-aftermarket-golf-weights-6g-12g": "Cobra Darkspeed LS, Max & X Driver",
    "/products/cobra-darkspeed-ls-max-x-ls-driver-aftermarket-golf-weights-kit": "Cobra Darkspeed LS, Max & X Driver",
    "/products/cobra-aerojet-max-ls-golf-club-driver-fairway-woods-hybrids-aftermarket-golf-weights-4g-16g": "Cobra Aerojet, Max & LS Driver, Fairway & Hybrid",
    "/products/cobra-aerojet-max-ls-golf-club-driver-fairway-woods-hybrids-aftermarket-golf-weights-kit": "Cobra Aerojet, Max & LS Driver, Fairway & Hybrid",
    "/products/cobra-ds-adapt-golf-club-driver-fairway-hybrid-aftermarket-golf-weights": "Cobra DS-Adapt Driver, Fairway & Hybrid",
    "/products/cobra-ds-adapt-driver-aftermarket-golf-weights-kit": "Cobra DS-Adapt Driver",
    "/products/cobra-ds-adapt-fairway-aftermarket-golf-weights-kit": "Cobra DS-Adapt Fairway",
    "/products/cobra-ds-adapt-aftermarket-golf-shaft-adapter-0-335-lh-driver": "Cobra DS-Adapt",
    "/products/cobra-ds-adapt-aftermarket-golf-shaft-adapter-0-335-rh-driver": "Cobra DS-Adapt",
    "/products/cobra-ds-adapt-aftermarket-golf-shaft-adapter-0-335-rh-fairways": "Cobra DS-Adapt",
    "/products/cobra-king-vintage-series-putter-aftermarket-golf-weights-5g-25g": "Cobra King Vintage Putter",
    "/products/cobra-king-vintage-3d-printed-series-putter-aftermarket-golf-weight-kits": "Cobra King Vintage 3D Printed Putter",
    "/products/cbl-aftermarket-golf-weights-wrench-for-cobra-ltdx-drivers-fairway-woods-hybrids-4g-18g": "Cobra LTDx Driver, Fairway & Hybrid",
    "/products/cobra-ltdx-fairway-woods-hybrids-aftermarket-golf-weights-4g-10g": "Cobra LTDx Fairway & Hybrid",
    "/products/cobra-sz-speedzone-fairway-woods-hybrids-aftermarket-golf-weights-4g-8g": "Cobra SZ Speedzone Fairway & Hybrid",
    "/products/cobra-optm-driver-fairway-hybrid-aftermarket-golf-weights": "Cobra OPTM Driver, Fairway & Hybrid",
    "/products/cobra-optm-driver-fairway-hybrid-aftermarket-golf-weights-kit": "Cobra OPTM Driver, Fairway & Hybrid",
    "/products/titleistts3-driver-aftermarket-magnetic-surefit-golf-weights-7g-19g": "Titleist TS3 Driver Magnetic SureFit",
    "/products/titleist-aftermarket-surefit-golf-sleeve-adapter-0-335-rh-lh-driver": "Titleist SureFit",
    "/products/titleist-aftermarket-golf-shaft-adapter-0-335-rh-lh-fairway": "Titleist SureFit",
    "/products/titleist-gt2-gt4-driver-fairway-wood-hybrid-aftermarket-golf-weights-19g-23g": "Titleist GT2 & GT4 Driver, Fairway & Hybrid",
    "/products/titleist-gt2-gt4-driver-fairway-wood-hybrid-aftermarket-golf-weights-kit": "Titleist GT2 & GT4 Driver, Fairway & Hybrid",
    "/products/titleist-gt2-gt4-hybrid-aftermarket-golf-weights": "Titleist GT2 & GT4 Hybrid",
    "/products/titleist-gt3-driver-fairway-wood-hybrid-aftermarket-golf-weights": "Titleist GT3 Driver, Fairway & Hybrid",
    "/products/titleist-gt3-driver-aftermarket-golf-weights-kit": "Titleist GT3 Driver",
    "/products/titleist-gt3-fairway-aftermarket-golf-weights": "Titleist GT3 Fairway",
    "/products/titleist-gts2-gts3-gts4-driver-fairway-wood-aftermarket-golf-weights": "Titleist GTS2, GTS3 & GTS4 Driver & Fairway",
    "/products/titleist-gts2-gts3-gts4-driver-fairway-wood-aftermarket-golf-weights-kit": "Titleist GTS2, GTS3 & GTS4 Driver & Fairway",
    "/products/titleist-tsr1-tsr2-tsr4-driver-fairway-wood-aftermarket-golf-weights-kit": "Titleist TSR1, TSR2 & TSR4 Driver & Fairway",
    "/products/quality-aftermarket-weight-for-titleist-ts2-ts4-driver-and-fairway-woods": "Titleist TS2 & TS4 Driver & Fairway",
    "/products/quality-aftermarket-weight-for-titleist-tsi2-tsi4-drivers-and-fairway-woods": "Titleist TSi2 & TSi4 Driver & Fairway Single Weight",
    "/products/aftermarket-golf-weights-wrench-for-titleist-tsi2-tsi4-drivers-and-fairway-woods-5g-21g": "Titleist TSi2 & TSi4 Driver & Fairway",
    "/products/tti3-aftermarket-golf-weights-wrench-for-titleist-tsi3-drivers-2-5g-18g": "Titleist TSi3 Driver",
    "/products/tts1-aftermarket-head-screw-golf-weights-wrench-for-titleist-ts1-drivers-5g-20g": "Titleist TS1 Driver Head Screw",
    "/products/pxg-black-ops-gen-6-gen-5-gen-4-0811-aftermarket-golf-shaft-adapter-0-335-lh-driver-fairway-woods": "PXG Black Ops & Gen 4–6 0811",
    "/products/pxg-black-ops-gen-6-gen-5-gen-4-0811-aftermarket-golf-sleeve-adapter-0-335-rh-driver-fairway-woods": "PXG Black Ops & Gen 4–6 0811",
    "/products/pxg-black-ops-gen6-0311-gen5-0311-gen4-0811-0317-0211-drivers-fairway-woods-hybrids-aftermarket-golf-weights-kit": "PXG Black Ops, Gen 4–6 (0311, 0811, 0317, 0211) Driver, Fairway & Hybrid",
    "/products/quality-aftermarket-weight-for-pxg-gen4-0811-0341-xgen4-0211-drivers-and-fairway-woods": "PXG Gen 4 0811, 0341 & XGen 4 0211 Driver & Fairway",
    "/products/pxgg-aftermarket-weights-for-pxg-gen-5-gen-4-0211-0317-0311-irons-set": "PXG Gen 4 & Gen 5 Irons (0211, 0317, 0311)",
    "/products/pxg-gen-8-irons-aftermarket-golf-weights": "PXG Gen 8 Irons",
    "/products/pxg-battle-ready-ii-battle-ready-collection-gen-2-collection-putters-aftermarket-golf-weights-kit": "PXG Battle Ready & Battle Ready II Putter",
    "/products/quality-aftermarket-putter-weight-for-for-pxg-battle-ready-gen-2-putters": "PXG Battle Ready Gen 2 Putter Single Weight",
    "/products/pxg-aftermarket-golf-shaft-adapter-0-370-lh-hybrids": "PXG",
    "/products/srixon-zxi-zxi-ls-zxi-max-driver-aftermarket-golf-weights": "Srixon ZXi, ZXi LS & ZXi Max Driver",
    "/products/srixon-zxi-zxi-ls-zxi-max-driver-aftermarket-golf-weights-kit": "Srixon ZXi, ZXi LS & ZXi Max Driver",
    "/products/srixon-zx5-zx7-mki-mkii-driver-aftermarket-golf-weights-kit": "Srixon ZX5 & ZX7 (MkI & MkII) Driver",
    "/products/srixon-zx5-zx7-z-series-aftermarket-golf-shaft-adapter-0-335-rh-driver-fairway-woods": "Srixon ZX5, ZX7 & Z-Series",
    "/products/srixon-zx-golf-weights": "Srixon ZX",
    "/products/srizon-zxi-aftermarket-golf-shaft-adapter-0-335-rh-driver-fairway-woods": "Srixon ZXi",
    "/products/mizuno-stg-stx-stz-aftermarket-golf-sleeve-adapter-0-335-rh-driver": "Mizuno ST-G, ST-X & ST-Z",
    "/products/mz-aftermarket-weights-for-mizuno-st-range-drivers": "Mizuno ST Range Driver",
    "/products/hnm-aftermarket-weights-for-honma-golf-t-world-tr20-gs-driver-fairway-woods": "Honma T//World TR20 & GS Driver & Fairway",
    "/products/lab-golf-club-putter-head-aftermarket-weights": "LAB Golf Putter",
    "/products/wilson-aftermarket-golf-shaft-adapter-0-335-rh-driver-fairway-woods": "Wilson",
    "/products/wilson-dynapower-series-aftermarket-golf-shaft-adapter-0-335-lh-driver-fairway-woods": "Wilson Dynapower",
    "/products/0-335-universal-fit-shaft-sleeve-adapter": "Universal Fit",
    "/products/lead-tape-self-adhesive-swing-weight-tape": "Golf Lead Tape — Self-Adhesive Swing Weight Tape",
    "/products/t15-aftermarket-wrench-very-small": "T15 Golf Wrench (Very Small)",
    "/products/t20-aftermarket-wrench-small": "T20 Golf Wrench (Small)",
    "/products/t25-aftermarket-wrench-large": "T25 Golf Wrench (Large)",
    "/products/t20-torque-wrench-for-taylormade-callaway-pxg": "T20 Torque Wrench (TaylorMade, Callaway & PXG)",
    "/products/t25-universal-torque-wrench-for-taylormade-titleist-callaway-ping-cobra-odyssey-pxg-mizuno-honma": "T25 Universal Golf Torque Wrench",
    "/products/taylormade-aftermarket-golf-sleeve-adapter-0-335-rh-driver-fairway": "TaylorMade",
    "/products/taylormade-aftermarket-golf-sleeve-adapter-0-335-rh-driver-fairway-woods": "TaylorMade",
    "/products/taylormade-qi35-stealth-sim-aftermarket-golf-shaft-adapter-0-335-lh-driver-fairway-woods": "TaylorMade Qi35, Stealth & SIM",
    "/products/quality-aftermarket-sliding-head-weight-for-taylormade-m5-driver": "TaylorMade M5 Driver Sliding",
    "/products/quality-aftermarket-sliding-head-weight-for-taylormade-m3-driver": "TaylorMade M3 Driver Sliding",
    "/products/tmm4-aftermarket-head-weight-for-taylormade-m4-driver-m4-tour-fairway-woods": "TaylorMade M4 Driver & M4 Tour Fairway",
    "/products/tmm6-aftermarket-head-weight-for-taylormade-m6-driver": "TaylorMade M6 Driver",
    "/products/taylormade-sim-max-d-driver-aftermarket-golf-weights-13g-20g": "TaylorMade SIM Max D Driver",
    "/products/taylormade-sim-max-driver-aftermarket-golf-weights-7g-17g": "TaylorMade SIM Max Driver",
    "/products/taylormade-spider-tour-putter-2023-aftermarket-golf-weights-kit": "TaylorMade Spider Tour Putter (2023)",
    "/products/taylormade-spider-tour-putter-aftermarket-golf-weights-2g-17g": "TaylorMade Spider Tour Putter",
    "/products/taylormade-tp-hydroblast-truss-putter-aftermarket-golf-head-weights-5g-20g": "TaylorMade TP Hydroblast & Truss Putter",
    "/products/taylormade-tp-hydroblast-truss-putter-aftermarket-golf-head-weights-kit": "TaylorMade TP Hydroblast & Truss Putter",
    "/products/ping-g440-fairway-woods-hybrids-aftermarket-golf-weights-kit": "Ping G440 Fairway & Hybrid",
    "/products/ping-g440-fairway-woods-aftermarket-golf-weights": "Ping G440 Fairway Wood",
    "/products/ping-g440-aftermarket-golf-shaft-adapter-0-335-lh-driver-fairway-woods": "Ping G440",
    "/products/ping-g440-aftermarket-golf-shaft-adapter-0-335-rh-driver-fairway-woods": "Ping G440",
    "/products/ping-g430-fairway-woods-hybrid-aftermarket-golf-weights-kit": "Ping G430 Fairway & Hybrid",
}

def name_for(p):
    if p["url"] in OVERRIDES:
        return OVERRIDES[p["url"]]
    return auto_name(p["url"])

if __name__ == "__main__":
    for p in PRODUCTS:
        g = grams_from_slug(p["url"])
        n = name_for(p)
        spec = adapter_spec(p["url"], p["club"]) if p["kind"] == "adapter" else ""
        tag = {"weights": f"Weights{' (' + g + ')' if g else ''}",
               "kit": "Weight Kit",
               "adapter": f"Shaft Adapter ({spec})" if spec else "Shaft Adapter",
               "wrench": ""}[p["kind"]]
        title = (n + (" " + tag if tag else "")).strip()
        print(f"{p['kind']:<7}| {title}")


GRAM_OVERRIDES = {
    "/products/putter-weights-for-taylormade-tp-collection-spider-mini-fsg-and-truss-putters-5g-10g-15g-20g-and-wrench": "5g\u201320g",
}
ALT_LISTING = {
    "/products/taylormade-aftermarket-golf-sleeve-adapter-0-335-rh-driver-fairway-woods",
    "/products/callaway-aftermarket-golf-sleeve-adapter-0-350-rh-driver-1",
    "/products/scotty-cameron-putter-aftermarket-golf-weights-5g-45g-copy-1",
    "/products/scotty-cameron-putter-aftermarket-golf-weights-kit-1",
    "/products/scotty-cameron-circle-t-insert-putter-aftermarket-golf-weights-1",
}

def product_h1(p):
    """Full product name / H1 (no site suffix)."""
    url = p["url"]
    n = name_for(p)
    g = GRAM_OVERRIDES.get(url) or grams_from_slug(url)
    kind = p["kind"]
    if kind == "wrench" or "Weight" in n or "Tape" in n:
        h1 = n + (f" ({g})" if g and "Weight" in n and kind != "wrench" else "")
    elif kind == "weights":
        h1 = f"{n} Weights" + (f" ({g})" if g else "")
    elif kind == "kit":
        h1 = f"{n} Weight Kit" + (f" ({g})" if g else "")
    elif kind == "adapter":
        spec = adapter_spec(url, p["club"])
        h1 = f"{n} Shaft Adapter" + (f" ({spec})" if spec else "")
    if url in ALT_LISTING:
        h1 += " — Alternate Listing"
    return h1
