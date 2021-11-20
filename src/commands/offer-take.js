'use strict'

// Local libraries
const WalletBalances = require('./wallet-balances')

const { Command, flags } = require('@oclif/command')
const WalletUtil = require('../lib/wallet-util')

class OfferTake extends Command {
  constructor (argv, config) {
    super(argv, config)

    // Encapsulate dependencies.
    this.walletUtil = new WalletUtil()
    this.walletBalances = new WalletBalances()
    this.avaxID = 'FvwEAhmxKfeiG8SnEvq42hc6whRyY3EFYAvebMqDNDGCgxN5Z'
  }

  async run () {
    try {
      const { flags } = this.parse(OfferTake)

      // Validate input flags
      this.validateFlags(flags)

      const filename = `${__dirname.toString()}/../../.wallets/${flags.name}.json`
      const referece = flags.referece
      const txHex = flags.txHex

      // Get the wallet with updated UTXO data.
      const txInfo = await this.offerTake(filename, txHex, referece)
      this.log(`Offer made: ${JSON.stringify(txInfo, null, 2)}`)
      return true
    } catch (err) {
      console.log('Error in run(): ', err)

      return false
    }
  }

  async offerTake (filename, txHex, addrReferences) {
    try {
      const walletData = await this.walletBalances.getBalances(filename)

      const asset = walletData.utxos.assets.find(item => item.assetID === this.avaxID)

      if (!asset) {
        throw new Error(
          'Insufficient funds. You are trying to send AVAX, but the wallet doesn\'t have any'
        )
      }

      const avaxID = walletData.bintools.cb58Decode(this.avaxID)
      addrReferences = JSON.parse(addrReferences)

      // Parse the old transaction
      const baseTx = new walletData.utxos.avm.BaseTx()
      const txBuffer = Buffer.from(txHex, 'hex')
      baseTx.fromBuffer(txBuffer)

      // handle avax input with optimal avax UTXO
      const outputs = baseTx.getOuts()
      const avaxOut = outputs.find(item => {
        return item.getAssetID().toString('hex') === avaxID.toString('hex')
      })

      const fee = walletData.tokens.xchain.getTxFee()
      const avaxRequired = avaxOut.getOutput().getAmount().add(fee)
      const avaxUtxo = await this.selectUTXO(avaxRequired.toNumber(), walletData.utxos.utxoStore)

      if (!avaxUtxo.amount) {
        this.log('Could not find a UTXO big enough for this transaction')
        throw new Error('Not enough avax in the selected utxo')
      }

      const address = walletData.walletInfo.address
      const avaxInput = walletData.utxos.encodeUtxo(avaxUtxo, address)
      const utxoID = avaxInput.getUTXOID()
      addrReferences[utxoID] = address

      // handle token output, referencing the first input as the token input
      const inputs = baseTx.getIns()
      const [tokenInput] = inputs
      const assetID = tokenInput.getAssetID()

      const tokenRemainderOut = outputs.find(item => {
        return item.getAssetID().toString('hex') !== avaxID.toString('hex')
      })
      let tokenRemainder = new walletData.BN(0)
      let tokenAmount = new walletData.BN(0)
      if (tokenRemainderOut) {
        tokenRemainder = tokenRemainderOut.getOutput().getAmount()
      }

      // Add up all the asset inputs
      for (const input of inputs) {
        if (input.getAssetID().toString('hex') !== assetID.toString('hex')) {
          continue
        }

        tokenAmount = tokenAmount.add(input.getInput().getAmount())
      }
      tokenAmount = tokenAmount.sub(tokenRemainder)

      const tokenOutput = walletData.utxos.formatOutput({
        amount: tokenAmount.toNumber(),
        address,
        assetID: walletData.bintools.cb58Encode(assetID)
      })

      inputs.push(avaxInput)
      outputs.push(tokenOutput)

      // send back the remainding avax if any
      const remainder = new walletData.BN(avaxUtxo.amount).sub(avaxRequired)
      if (remainder.gt(new walletData.BN(0))) {
        const remainderOut = walletData.utxos.formatOutput({
          amount: remainder,
          address,
          assetID: this.avaxID
        })

        outputs.push(remainderOut)
      }

      // Build the transcation
      const partialTx = new walletData.utxos.avm.BaseTx(
        walletData.ava.getNetworkID(),
        walletData.bintools.cb58Decode(walletData.tokens.xchain.getBlockchainID()),
        outputs,
        inputs,
        Buffer.from('Tx created from offer take command')
      )

      // Partially sign the tx
      const keyChain = walletData.tokens.xchain.keyChain()
      keyChain.importKey(walletData.walletInfo.privateKey)

      const unsigned = new walletData.utxos.avm.UnsignedTx(partialTx)

      const signed = this.walletUtil.partialySignTx(
        walletData,
        unsigned,
        keyChain,
        addrReferences
      )
      const hexString = signed.toBuffer().toString('hex')
      this.walletUtil.readTx(hexString, walletData)
      return {
        txHex: hexString,
        addrReferences: JSON.stringify(addrReferences)
      }
    } catch (err) {
      console.log('Error in offer-make.js/offerTake()', err)
      throw err
    }
  }

  selectUTXO (amount, utxos) {
    let candidateUTXO = {}

    const total = amount
    // if it's a new wallet
    if (!utxos) {
      utxos = []
    }

    // Loop through each utxo.
    for (let i = 0; i < utxos.length; i++) {
      const thisUTXO = utxos[i]

      if (thisUTXO.amount < total) {
        continue
      }
      // Automatically assign if the candidateUTXO is an empty object.
      if (!candidateUTXO.amount) {
        candidateUTXO = thisUTXO
        continue
      }

      // Replace the candidate if the current UTXO is closer to the send amount.
      if (candidateUTXO.amount > thisUTXO.amount) {
        candidateUTXO = thisUTXO
      }
    }

    return candidateUTXO
  }

  // Validate the proper flags are passed in.
  validateFlags (flags) {
    // Exit if wallet not specified.
    const name = flags.name
    if (!name || name === '') {
      throw new Error('You must specify a wallet with the -n flag.')
    }

    const txHex = flags.txHex
    if (typeof txHex !== 'string' || !txHex.length) {
      throw new Error('You must specify transaction hex with the -h flag')
    }

    let referece = flags.referece
    if (typeof referece !== 'string' || !referece.length) {
      throw new Error('You must specify the utxos address reference with the -r flag')
    }

    referece = JSON.parse(referece)

    return true
  }
}

OfferTake.description = 'Display the balances of the wallet'

OfferTake.flags = {
  name: flags.string({ char: 'n', description: 'Name of wallet' }),
  referece: flags.string({
    char: 'r',
    description: 'the address reference as JSON'
  }),
  txHex: flags.string({
    char: 'h',
    description: 'the previous partial transaction encoded as hex'
  })
}

module.exports = OfferTake
