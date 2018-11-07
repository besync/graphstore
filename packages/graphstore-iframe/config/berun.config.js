const runnerIframe = require('react-use-iframe/berun')

module.exports = {
  use: [
    '@berun/preset-react',
    '@berun/runner-tslint',
    '@berun/runner-prettier',
    runnerIframe,
    berun => {
      berun.webpack.bail(true)
    }
  ]
}