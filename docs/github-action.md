<!-- markdownlint-disable -->

## Inputs

| Name | Description | Default | Required |
|------|-------------|---------|----------|
| atmos-version | Version Spec of the version to use. Examples: 1.x, 10.15.1, >=10.15.0. | latest | false |
| install-wrapper | Flag to indicate if the wrapper script will be installed to wrap subsequent calls of the `atmos` binary and expose its STDOUT, STDERR, and exit code as outputs named `stdout`, `stderr`, and `exitcode` respectively. Defaults to `true`. | true | false |
| token | Used to pull atmos distributions from Cloud Posse's GitHub repository. Since there's a default, this is typically not supplied by the user. When running this action on github.com, the default value is sufficient. When running on GHES, you can pass a personal access token for github.com if you are experiencing rate limiting. | ${{ github.server\_url == 'https://github.com' && github.token \|\| '' }} | false |


## Outputs

| Name | Description |
|------|-------------|
| atmos-version | The installed atmos version. |
<!-- markdownlint-restore -->
