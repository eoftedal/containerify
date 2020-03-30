# Changelog


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
