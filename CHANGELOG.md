# Changelog

## [1.0.1] - 2022-02-06

### Fix

- Remove debug residue

## [1.0.0] - 2022-02-06

### Rewrite

- Rewritten to TypeScript

## [0.6.0] - 2022-02-03

### Added

- Support for config as .json-file

## [0.5.0] - 2022-01-19

### Added

- Support for adding environment variables similar to labels

### Fixed

- Don't try to add labels if none are specified

## [0.4.2] - 2023-01-19

### Fixed

- Initialize `config.container_config` in case it's `undefined`

## [0.4.1] - 2022-03-24

### Dependency update / security

- Update minimist due to vuln in 1.2.5: https://github.com/advisories/GHSA-xvch-5gv4-984h

## [0.4.0] - 2021-04-12

### Added

- Allow specifying multiple labels by using `--label` multiple times

## [0.3.2] - 2021-04-12

### Fixed

- Update help and readme

## [0.3.1] - 2021-02-10

### Fixed

- Unwanted debug logging

## [0.3.0] - 2021-02-10

### Added

- Possible to add additional files/folders to specified destinations in the image with `--extraContent`

## [0.2.0] - 2020-08-05

### Added

- Support for setting the owner of the work folder (gid:uid)

## [0.1.0] - 2020-03-30

### Added

- Support custom layer (drops default entrypoint, user, workdir, node_modules layer and app layer). Only adds the specified files

## [0.0.11] - 2020-03-30

### Modified

- Don't include .git and .gitignore if in same folder

## [0.0.10] - 2020-03-08

### Modified

- Updated the README with improved example and missing option for the timestamp

## [0.0.9] - 2020-03-08

### Removed

- Removed files from npm package and simplified package.json to use defaults

## [0.0.8] - 2020-03-08

### Added

- Ability to set a specific timestamp on all files/tars/configs to support hermetic builds. Typically one would use the git commit time (`--setTimeStamp=$(git show -s --format="%aI" HEAD)`). If omitted, the timestamp is set to epoch 0. [`420e248`](https://github.com/eoftedal/doqr/commit/420e248e4daf5470e91834f11a52633a566f5783)
