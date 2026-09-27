# Vendored dependencies

- `OpenZeppelin/openzeppelin-contracts` `v5.0.2`: https://codeload.github.com/OpenZeppelin/openzeppelin-contracts/tar.gz/refs/tags/v5.0.2
  Archive SHA-256: `18c7b7e949b9a82dcd8cd394426c9c2636dfc263aa2317d4749dbfa0c7b3925a`.
  Vendored 10 source/license files into `lib/openzeppelin-contracts`.

- `foundry-rs/forge-std` `v1.9.7`: https://codeload.github.com/foundry-rs/forge-std/tar.gz/refs/tags/v1.9.7
  Archive SHA-256: `45157353ab49eab01d294565866731e599b32401757229689ee459aa26b7ee94`.
  Vendored 30 source/license files into `lib/forge-std`.

OpenZeppelin includes only the source dependency closure used by the contracts.
forge-std includes its Solidity sources and licenses. No submodules, package installs,
network access, FFI or filesystem cheatcodes are needed to build or run the tests.
