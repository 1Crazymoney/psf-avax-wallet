/*
  Utility library for working with wallet files.
*/

const fs = require('fs').promises
const BCHJS = require('@psf/bch-js')
const Conf = require('conf')

const { Signature } = require('avalanche/dist/common/credentials')
const avm = require('avalanche/dist/apis/avm')
const createHash = require('create-hash')

let _this // Global variable points at instance of this Class.

class WalletUtil {
  constructor (localConfig = {}) {
    this.fs = fs
    this.bchjs = new BCHJS()
    this.conf = new Conf()

    this.Signature = Signature
    this.avm = avm
    this.avm = avm
    this.createHash = createHash

    _this = this
  }

  // Open a wallet by file name.
  openWallet (filename) {
    try {
      // Delete the cached copy of the wallet. This allows testing of list-wallets.
      delete require.cache[require.resolve(filename)]

      const walletInfo = require(filename)
      return walletInfo
    } catch (err) {
      throw new Error(`Could not open ${filename}`)
    }
  }

  // Save the wallet data into a .json text file.
  async saveWallet (filename, walletData) {
    await _this.fs.writeFile(filename, JSON.stringify(walletData, null, 2))

    return true
  }

  // Save the wallet data into a .json text file.
  async walletExists (filename) {
    try {
      await _this.fs.access(filename)
      return true
    } catch (error) {
      return false
    }
  }

  // Generates an array of HD addresses.
  // Address are generated from index to limit.
  // e.g. generateAddress(walletData, 20, 10)
  // will generate a 10-element array of addresses from index 20 to 29
  async generateAddress (walletData, index, limit) {
    // console.log(`walletData: ${JSON.stringify(walletData, null, 2)}`)

    if (!walletData.mnemonic) throw new Error('mnemonic is undefined!')

    // root seed buffer
    const rootSeed = await this.bchjs.Mnemonic.toSeed(walletData.mnemonic)

    // master HDNode
    const masterHDNode = this.bchjs.HDNode.fromSeed(rootSeed)

    // HDNode of BIP44 account
    const account = this.bchjs.HDNode.derivePath(
      masterHDNode,
      `m/44'/${walletData.derivation}'/0'`
    )

    // Empty array for collecting generated addresses
    const bulkAddresses = []

    // Generate the addresses.
    for (let i = index; i < index + limit; i++) {
      // derive an external change address HDNode
      const change = this.bchjs.HDNode.derivePath(account, `0/${i}`)

      // get the cash address
      const newAddress = this.bchjs.HDNode.toCashAddress(change)
      // const legacy = this.bchjs.HDNode.toLegacyAddress(change)

      // push address into array
      bulkAddresses.push(newAddress)
    }

    return bulkAddresses
  }

  // Retrieves the 12-word menomnic used for e2e encryption with the wallet
  // service. If it doesn't exist in the config, then it will be created.
  getEncryptionMnemonic () {
    let e2eeMnemonic = this.conf.get('e2eeMnemonic', false)

    // If the mnemonic doesn't exist, generate it and save to the config.
    if (!e2eeMnemonic) {
      const mnemonic = this.bchjs.Mnemonic.generate(
        128,
        this.bchjs.Mnemonic.wordLists().english
      )

      this.conf.set('e2eeMnemonic', mnemonic)

      e2eeMnemonic = mnemonic
    }

    return e2eeMnemonic
  }

  /**
   * This method assumes that all the utxos have only one associated address
   * @param {avm.UnsignedTx} tx
   * @param {KeyChain} keychain
   * @param {Object} reference
   * @param {Credential} credentials
   */
  partialySignTx (walletData, tx, keychain, reference = {}, oldCredentials = []) {
    const txBuffer = tx.toBuffer()
    const msg = Buffer.from(this.createHash('sha256').update(txBuffer).digest())
    const credentials = [...oldCredentials]

    const inputs = tx.getTransaction().getIns()
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]
      const cred = this.avm.SelectCredentialClass(input.getInput().getCredentialID())

      const inputid = input.getUTXOID()

      try {
        const source = walletData.tokens.xchain.parseAddress(reference[inputid])
        const keypair = keychain.getKey(source)
        const signval = keypair.sign(msg)
        const sig = new this.Signature()
        sig.fromBuffer(signval)
        cred.addSignature(sig)

        console.log(`input ${i}: Successfully signed, ( ${inputid} signed with ${reference[inputid]} )`)
        credentials[i] = cred
      } catch (error) {
        console.log(`input ${i}: Skipping, address is not in the keychain, ( ${inputid} )`)

        if (!credentials[i]) {
          credentials[i] = cred
        }
      }
    }
    return new this.avm.Tx(tx, credentials)
  }
}

module.exports = WalletUtil
