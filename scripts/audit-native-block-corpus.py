"""Independent, scoped source comparison. Not a CAD/PDF compatibility certificate."""
import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf.math import Matrix44
from ezdxf.lldxf.encoding import decode_dxf_unicode
from ezdxf.lldxf.tagger import ascii_tags_loader
from io import StringIO

source_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "DXF-Test-Corpus")
output_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/native-block-corpus")
report = json.loads((output_dir / "report.json").read_text())


def equal(a, b):
    if isinstance(a, str) and isinstance(b, str):
        return decode_dxf_unicode(a) == decode_dxf_unicode(b)
    if isinstance(a, (float, int)) and isinstance(b, (float, int)):
        return math.isclose(a, b, rel_tol=0, abs_tol=1e-7)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    return a == b


def signature(entity):
    kind = entity.dxftype()
    d = entity.dxf
    result = [kind, d.layer]
    if kind == "LINE":
        result += [tuple(d.start), tuple(d.end)]
    elif kind in ("CIRCLE", "ARC"):
        result += [tuple(d.center), d.radius]
        if kind == "ARC":
            result += [d.start_angle % 360, d.end_angle % 360]
    elif kind == "LWPOLYLINE":
        result += [entity.closed, [tuple(point) for point in entity.get_points()]]
    elif kind in ("TEXT", "ATTRIB", "ATTDEF"):
        result += [tuple(d.insert), d.text, d.height, d.get("rotation", 0) % 360]
        if kind != "TEXT":
            result += [d.tag, d.flags]
        if kind == "ATTDEF":
            result += [d.get("prompt", "")]
    elif kind == "INSERT":
        result += [d.name, tuple(d.insert), d.get("rotation", 0) % 360,
                   d.xscale, d.yscale, d.zscale, [signature(a) for a in entity.attribs]]
    else:
        raise AssertionError(f"Unsupported test geometry: {kind}")
    return result


def reachable_blocks(document):
    pending = [e.dxf.name for e in document.modelspace().query("INSERT")]
    result = {}
    while pending:
        name = pending.pop()
        key = name.casefold()
        if key in result:
            continue
        block = document.blocks[name]
        result[key] = block
        pending.extend(e.dxf.name for e in block.query("INSERT"))
    return result


checked = 0
excluded = []


def preserved_sections(path):
    # Compare the original tag stream, not ezdxf's normalized object model.
    tags = list(ascii_tags_loader(StringIO(path.read_text())))
    result = {}
    for i, tag in enumerate(tags):
        if tag == (0, "SECTION"):
            name = tags[i + 1].value
            end = next(j for j in range(i + 2, len(tags)) if tags[j] == (0, "ENDSEC"))
            if name != "ENTITIES":
                result[name] = tags[i:end + 1]
    return result


for entry in report["results"]:
    if not entry["accepted"]:
        continue
    source = ezdxf.readfile(source_dir / entry["source"])
    original_blocks = reachable_blocks(source)
    excluded.append({"file": entry["file"], "unreferencedDefinitions": [block.name for block in source.blocks
                     if not block.name.lower().startswith(("*model_space", "*paper_space")) and block.name.casefold() not in original_blocks]})
    for phase in ("before", "after"):
        actual = ezdxf.readfile(output_dir / f"{phase}-{entry['file']}")
        assert preserved_sections(source_dir / entry["source"]) == preserved_sections(output_dir / f"{phase}-{entry['file']}"), (entry["file"], phase, "source sections differ")
        audit = actual.audit()
        assert not audit.errors and not audit.fixes, (entry["file"], audit.errors, audit.fixes)
        assert source.header["$INSUNITS"] == actual.header["$INSUNITS"]
        expected_entities = [e.copy() for e in source.modelspace()]
        if phase == "after":
            t = report["transform"]
            matrix = Matrix44.chain(Matrix44.scale(t["scale"]), Matrix44.z_rotate(math.radians(t["angle"])), Matrix44.translate(t["dx"], t["dy"], 0))
            for entity in expected_entities:
                if entity.dxftype() == "INSERT":
                    entity.transform(matrix)
                    if entity.attribs:
                        entity.attribs[0].dxf.text += " / edited"
        expected = [signature(e) for e in expected_entities]
        observed = [signature(e) for e in actual.modelspace()]
        assert equal(expected, observed), (entry["file"], phase, expected, observed)
        actual_blocks = {block.name.casefold(): block for block in actual.blocks
                         if not block.name.lower().startswith(("*model_space", "*paper_space"))}
        all_original = {block.name.casefold() for block in source.blocks
                        if not block.name.lower().startswith(("*model_space", "*paper_space"))}
        assert all_original == set(actual_blocks), (entry["file"], phase, "original block set differs")
        for name, original in original_blocks.items():
            block = actual_blocks[name]
            assert equal(tuple(original.base_point), tuple(block.base_point))
            assert equal([signature(e) for e in original], [signature(e) for e in block]), (entry["file"], block.name)
        checked += 1
print(f"Independent source geometry/attributes/unit + non-ENTITIES tag preservation: {checked}/36; zero audit errors/fixes. Not full compatibility.")
assert checked == 36
(output_dir / "audit.json").write_text(json.dumps({"scope": "reachable-block-geometry-and-all-non-ENTITIES-tags", "fullCompatibility": False,
                                                "checked": checked, "excluded": excluded}, indent=2))
