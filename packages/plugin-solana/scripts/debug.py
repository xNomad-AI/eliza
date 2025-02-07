from pathlib import Path
import json

def start():
    # read plugins
    content = Path(__file__).parent.parent.joinpath("package.json").read_text()

    commands = []
    for k, v in json.loads(content)['dependencies'].items():
        if v == "workspace:*":
            # keys.append(k)
            command = f"pnpm --dir packages/{k.split('/')[1]} build"
            print(command)


if __name__ == "__main__":
    start()
