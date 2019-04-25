const fs = require('fs-extra');
const passwdStrength = require('passwd-strength');
const bitcoin = require('bitcoinjs-lib');
const sha256 = require('js-sha256');
const bigi = require('bigi');
const aes256 = require('nodejs-aes256');
const iocane = require('iocane');
const session = iocane.createSession()
  .use('cbc')
  .setDerivationRounds(300000);
const encrypt = session.encrypt.bind(session);
const decrypt = session.decrypt.bind(session);
const pinObjSchema = require('./pinSchema');

module.exports = (api) => {
  api.updateActiveWalletFSData = () => {
    const fsObj = JSON.stringify({
      type: api.wallet.type,
      data: api.wallet.data,
    });

    api.log(JSON.stringify(api.wallet.data), 'pin contents');

    encrypt(fsObj, api.wallet.pin)
    .then((encryptedString) => {
      fs.writeFile(`${api.agamaDir}/shepherd/pin/${api.wallet.fname}.pin`, encryptedString, (err) => {
        if (err) {
          api.log(`error writing pin file ${api.wallet.fname}.pin`, 'pin');
        }
      });
    });
  };

  api.get('/getwalletdata', async (req, res, next) => {
    if (api.checkToken(req.query.token)) {
      const retObj = {
        msg: api.appConfig.dev ? 'success' : 'error',
        result: api.appConfig.dev ? api.wallet : '',
      };

      res.end(JSON.stringify(retObj));
    }
  });

  /*
   *  type: POST
   *  params: none
   */
  api.post('/encryptkey', async (req, res, next) => {
    if (api.checkToken(req.body.token)) {
      const _pin = req.body.key;
      const _str = req.body.string;
      const _type = req.body.type;

      if (_type &&
          pinObjSchema[_type]) {
        if (_pin &&
            _str) {
          const hash = sha256.create().update(_str);
          let bytes = hash.array();
          bytes[0] &= 248;
          bytes[31] &= 127;
          bytes[31] |= 64;

          const d = bigi.fromBuffer(bytes);
          const keyPair = new bitcoin.ECPair(d, null, { network: api.getNetworkData('btc') });
          const keys = {
            pub: keyPair.getAddress(),
            priv: keyPair.toWIF(),
          };
          const pubkey = req.body.pubkey ? req.body.pubkey : keyPair.getAddress();

          if (passwdStrength(_pin) < 29) {
            api.log('seed storage weak pin!', 'pin');

            const retObj = {
              msg: 'error',
              result: false,
            };

            res.end(JSON.stringify(retObj));
          } else {
            const _customPinFilenameTest = /^[0-9a-zA-Z-_]+$/g;

            if (_customPinFilenameTest.test(pubkey)) {
              let _data = pinObjSchema[_type]; 

              if (pinObjSchema[_type].keys.hasOwnProperty('seed')) {
                _data = JSON.parse(JSON.stringify(pinObjSchema[_type]));
                _data.keys.seed = _str;
              }

              const fsObj = JSON.stringify({
                type: _type,
                data: _data,
              });

              encrypt(fsObj, _pin)
              .then((encryptedString) => {
                fs.writeFile(`${api.agamaDir}/shepherd/pin/${pubkey}.pin`, encryptedString, (err) => {
                  if (err) {
                    api.log('error writing pin file', 'pin');

                    const retObj = {
                      msg: 'error',
                      result: 'error writing pin file',
                    };

                    res.end(JSON.stringify(retObj));
                  } else {
                    const retObj = {
                      msg: 'success',
                      result: pubkey,
                    };

                    res.end(JSON.stringify(retObj));
                  }
                });
              });
            } else {
              const retObj = {
                msg: 'error',
                result: 'pin file name can only contain alphanumeric characters, dash "-" and underscore "_"',
              };

              res.end(JSON.stringify(retObj));
            }
          }
        } else {
          const _paramsList = [
            'key',
            'string'
          ];
          let retObj = {
            msg: 'error',
            result: '',
          };
          let _errorParamsList = [];

          for (let i = 0; i < _paramsList.length; i++) {
            if (!req.query[_paramsList[i]]) {
              _errorParamsList.push(_paramsList[i]);
            }
          }

          retObj.result = `missing param ${_errorParamsList.join(', ')}`;
          res.end(JSON.stringify(retObj));
        }
      } else {
        const retObj = {
          msg: 'error',
          result: 'missing or wrong type param',
        };

        res.end(JSON.stringify(retObj));
      }
    } else {
      const retObj = {
        msg: 'error',
        result: 'unauthorized access',
      };

      res.end(JSON.stringify(retObj));
    }
  });

  api.post('/decryptkey', (req, res, next) => {
    if (api.checkToken(req.body.token)) {
      const _pubkey = req.body.pubkey;
      const _key = req.body.key;

      if (_key &&
          _pubkey) {
        if (fs.existsSync(`${api.agamaDir}/shepherd/pin/${_pubkey}.pin`)) {
          fs.readFile(`${api.agamaDir}/shepherd/pin/${_pubkey}.pin`, 'utf8', async(err, data) => {
            if (err) {
              const retObj = {
                msg: 'error',
                result: err,
              };

              res.end(JSON.stringify(retObj));
            } else {
              const decryptedKey = aes256.decrypt(_key, data);
              const _regexTest = decryptedKey.match(/^[0-9a-zA-Z ]+$/g);

              if (_regexTest) { // re-encrypt with a new method
                encrypt(decryptedKey, _key)
                .then((encryptedString) => {
                  api.log(`seed encrypt old method detected for file ${_pubkey}`, 'pin');

                  fs.writeFile(`${api.agamaDir}/shepherd/pin/${_pubkey}.pin`, encryptedString, (err) => {
                    if (err) {
                      api.log(`error re-encrypt pin file ${_pubkey}`, 'pin');
                    } else {
                      let objv1 = JSON.parse(JSON.stringify(pinObjSchema.default));
                      objv1.keys.seed = decryptedKey;
  
                      api.wallet = {
                        fname: _pubkey,
                        pin: _key,
                        type: 'default',
                        data: objv1,
                      };

                      const retObj = {
                        msg: 'success',
                        result: {
                          seed: api.wallet.data.keys.seed,
                          coins: api.wallet.data.coins,
                        },
                      };

                      res.end(JSON.stringify(retObj));
                    }
                  });
                });
              } else {
                decrypt(data, _key)
                .then((decryptedKey) => {
                  api.log(`pin ${_pubkey} decrypted`, 'pin');

                  const decryptedKeyObj = JSON.parse(decryptedKey);
                  
                  if (typeof decryptedKeyObj === 'object') { // v2
                    api.wallet = {
                      fname: _pubkey,
                      pin: _key,
                      type: decryptedKeyObj.type,
                      data: decryptedKeyObj.data,
                    };
                  } else { // v1
                    let objv1 = JSON.parse(JSON.stringify(pinObjSchema.default));
                    objv1.keys.seed = decryptedKey;

                    api.wallet = {
                      fname: _pubkey,
                      pin: _key,
                      type: 'default',
                      data: objv1,
                    };
                  }

                  api.log(JSON.stringify(decryptedKeyObj.data), 'pin contents decrypt');

                  const retObj = {
                    msg: 'success',
                    result: {
                      seed: api.wallet.data.keys.seed,
                      coins: api.wallet.data.coins,
                    },
                  };

                  res.end(JSON.stringify(retObj));
                })
                .catch((err) => {
                  api.log(`pin ${_pubkey} decrypt err ${err}`, 'pin');

                  const retObj = {
                    msg: 'error',
                    result: 'wrong key',
                  };

                  res.end(JSON.stringify(retObj));
                });
              }
            }
          });
        } else {
          const retObj = {
            msg: 'error',
            result: `file ${_pubkey}.pin doesnt exist`,
          };

          res.end(JSON.stringify(retObj));
        }
      } else {
        const retObj = {
          msg: 'error',
          result: 'missing key or pubkey param',
        };

        res.end(JSON.stringify(retObj));
      }
    } else {
      const retObj = {
        msg: 'error',
        result: 'unauthorized access',
      };

      res.end(JSON.stringify(retObj));
    }
  });

  api.get('/getpinlist', (req, res, next) => {
    if (api.checkToken(req.query.token)) {
      if (fs.existsSync(`${api.agamaDir}/shepherd/pin`)) {
        fs.readdir(`${api.agamaDir}/shepherd/pin`, (err, items) => {
          let _pins = [];

          for (let i = 0; i < items.length; i++) {
            if (items[i].substr(items[i].length - 4, 4) === '.pin') {
              _pins.push(items[i].substr(0, items[i].length - 4));
            }
          }

          if (!items.length) {
            const retObj = {
              msg: 'error',
              result: 'no pins',
            };

            res.end(JSON.stringify(retObj));
          } else {
            const retObj = {
              msg: 'success',
              result: _pins,
            };

            res.end(JSON.stringify(retObj));
          }
        });
      } else {
        const retObj = {
          msg: 'error',
          result: 'pin folder doesn\'t exist',
        };

        res.end(JSON.stringify(retObj));
      }
    } else {
      const retObj = {
        msg: 'error',
        result: 'unauthorized access',
      };

      res.end(JSON.stringify(retObj));
    }
  });

  api.post('/modifypin', (req, res, next) => {
    if (api.checkToken(req.body.token)) {
      const pubkey = req.body.pubkey;

      if (pubkey) {
        if (fs.existsSync(`${api.agamaDir}/shepherd/pin/${pubkey}.pin`)) {
          fs.readFile(`${api.agamaDir}/shepherd/pin/${pubkey}.pin`, 'utf8', (err, data) => {
            if (err) {
              const retObj = {
                msg: 'error',
                result: err,
              };

              res.end(JSON.stringify(retObj));
            } else {
              if (req.body.delete) {
                fs.unlinkSync(`${api.agamaDir}/shepherd/pin/${pubkey}.pin`);

                const retObj = {
                  msg: 'success',
                  result: `${pubkey}.pin is removed`,
                };

                res.end(JSON.stringify(retObj));
              } else {
                const pubkeynew = req.body.pubkeynew;
                const _customPinFilenameTest = /^[0-9a-zA-Z-_]+$/g;

                if (pubkeynew) {
                  if (_customPinFilenameTest.test(pubkeynew)) {
                    fs.writeFile(`${api.agamaDir}/shepherd/pin/${pubkeynew}.pin`, data, (err) => {
                      if (err) {
                        api.log('error writing pin file', 'pin');

                        const retObj = {
                          msg: 'error',
                          result: 'error writing pin file',
                        };

                        res.end(JSON.stringify(retObj));
                      } else {
                        fs.unlinkSync(`${api.agamaDir}/shepherd/pin/${pubkey}.pin`);

                        const retObj = {
                          msg: 'success',
                          result: pubkeynew,
                        };

                        res.end(JSON.stringify(retObj));
                      }
                    });
                  } else {
                    const retObj = {
                      msg: 'error',
                      result: 'pin file name can only contain alphanumeric characters, dash "-" and underscore "_"',
                    };

                    res.end(JSON.stringify(retObj));
                  }
                } else {
                  const retObj = {
                    msg: 'error',
                    result: 'missing param pubkeynew',
                  };

                  res.end(JSON.stringify(retObj));
                }
              }
            }
          });
        } else {
          const retObj = {
            msg: 'error',
            result: `file ${pubkey}.pin doesnt exist`,
          };

          res.end(JSON.stringify(retObj));
        }
      } else {
        const retObj = {
          msg: 'error',
          result: 'missing pubkey param',
        };

        res.end(JSON.stringify(retObj));
      }
    } else {
      const retObj = {
        msg: 'error',
        result: 'unauthorized access',
      };

      res.end(JSON.stringify(retObj));
    }
  });

  return api;
};