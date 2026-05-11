import importlib
import importlib.util
import sys
from pathlib import Path


def _load_cli():
    if __package__:
        return importlib.import_module(f"{__package__}.cli").cli

    package_name = "_bgdrawer_package"
    package_path = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(
        package_name,
        package_path / "__init__.py",
        submodule_search_locations=[str(package_path)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[package_name] = module
    spec.loader.exec_module(module)
    return importlib.import_module(f"{package_name}.cli").cli


cli = _load_cli()


if __name__ == "__main__":
    cli()
