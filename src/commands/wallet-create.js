'use strict'

// Public NPM libraries
const AvaxWallet = require('minimal-avax-wallet/index')

// Local libraries
const WalletUtil = require('../lib/wallet-util')

const { Command, flags } = require('@oclif/command')

class WalletCreate extends Command {
  constructor (argv, config) {
    super(argv, config)

    // Encapsulate dependencies.
    this.walletUtil = new WalletUtil()
    this.AvaxWallet = AvaxWallet
  }

  async run () {
    try {
      const { flags } = this.parse(WalletCreate)

      // Validate input flags
      this.validateFlags(flags)

      const filename = `${__dirname.toString()}/../../.wallets/${flags.name}.json`

      if (!flags.description) flags.description = ''

      const result = await this.createWallet(filename, flags.description, flags.priv)
      // console.log('result: ', result)

      return result
    } catch (error) {
      if (error.message) console.log(error.message)
      else console.log('Error in create-wallet.js/run():', error)

      return 0
    }
  }

  // Create a new wallet file.
  async createWallet (filename, desc, privateKey) {
    try {
      if (!filename || typeof filename !== 'string') {
        throw new Error('filename required.')
      }

      // check if wallet name is taken
      const exists = await this.walletUtil.walletExists(filename)
      if (exists) {
        throw new Error('filename already exist')
      }

      if (!desc) desc = ''

      // Configure the minimal-slp-wallet library to use the JSON RPC over IPFS.
      const advancedConfig = {
        interface: 'json-rpc',
        noUpdate: true
      }

      // Wait for the wallet to be created.
      this.avaxWallet = new this.AvaxWallet(privateKey, advancedConfig)
      await this.avaxWallet.walletInfoPromise

      // Create the initial wallet JSON object.
      const walletData = {
        wallet: this.avaxWallet.walletInfo
      }
      walletData.wallet.description = desc

      // Write out the basic information into a json file for other apps to use.
      await this.walletUtil.saveWallet(filename, walletData)

      return walletData.wallet
    } catch (error) {
      if (error.code !== 'EEXIT') console.log('Error in createWallet():', error.message)
      throw error
    }
  }

  // Validate the proper flags are passed in.
  validateFlags (flags) {
    // Exit if wallet not specified.
    const name = flags.name
    if (!name || name === '') {
      throw new Error('You must specify a wallet with the -n flag.')
    }

    return true
  }
}

WalletCreate.description = 'Generate a new single address Wallet.'

WalletCreate.flags = {
  name: flags.string({ char: 'n', description: 'Name of wallet' }),
  priv: flags.string({ char: 'k', description: 'key' }),
  description: flags.string({
    char: 'd',
    description: 'Description of the wallet'
  })
}

module.exports = WalletCreate
