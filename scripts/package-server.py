"""Build a standalone server plugin ZIP with the byte-identical original lorebook and no user data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / "server-plugin"
destination = root / "downloads" / "crowdlens-server.zip"
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    for file in sorted(source.rglob("*")):
        if file.is_file():
            archive.write(file, "crowdlens/" + file.relative_to(source).as_posix())
    archive.write(root / "prompts" / "community-reactions.json", "crowdlens/prompts/community-reactions.json")
print(destination)
