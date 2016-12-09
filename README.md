# Sequlize-Auto-Fulcrum

Automatically generate models for SequelizeJS from [Fulcrum](https://github.com/fulcrumapp) apps.  Concept and much of the code was originally derived from [sequelize-auto](https://github.com/sequelize/sequelize-auto).

## Usage

### CLI

```
[node] sequelize-auto-fulcrum -k <key> -f <form_id> -p <parent> -o
[output] -a [additional]

Options:
  -k, --key         API Key.                                          [required]
  -f, --form_id     Form ID.                                          [required]
  -p, --parent      Arbitrary name for the parent table.              [required]
  -o, --output      What directory to place the models.
  -a, --additional  Path to a json file containing model definitions (for all
                    tables) which are to be defined within a model's
                    configuration parameter. For more info:
                    https://sequelize.readthedocs.org/en/latest/docs/models-defi
                    nition/#configuration
```

### Node.js

(Todo)

## Test

(Todo)
