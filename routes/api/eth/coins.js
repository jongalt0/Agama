module.exports = (api) => {  
  api.ethAddCoin = (coin) => {
    const _coinuc = coin.toUpperCase();
    
    if (!api.eth.wallet) {
      api.eth.wallet = {};
    }

    if (api.seed) {
      const mnemonicWallet = api.eth._keys(api.seed);

      api.eth.wallet = mnemonicWallet;
    }

    if (!api.eth.coins) {
      api.eth.coins = {};
    }

    if (coin &&
        !api.eth.coins[_coinuc]) {
      if (api.eth.wallet.signingKey &&
          api.eth.wallet.signingKey.address) {
        const network = coin.toLowerCase().indexOf('ropsten') > -1 ? 'ropsten' : 'homestead';
        api.eth._connect(coin, network);
        
        api.eth.coins[_coinuc] = {
          pub: api.eth.wallet.signingKey.address,
          network,
        };
      } else {
        api.eth.coins[_coinuc] = {};
      }

      if (api.wallet.fname) {
        api.wallet.data.coins = api.getActiveCoins();
        api.updateActiveWalletFSData();
      }

      return {
        msg: 'success',
        result: 'true',
      };
    } else {
      return {
        msg: 'error',
        result: `${_coinuc} is active`,
      };
    }
  };

  api.get('/eth/coins', (req, res, next) => {
    if (api.eth.wallet &&
        api.eth.coins &&
        Object.keys(api.eth.coins).length) {
      let _coins = {};

      const retObj = {
        msg: 'success',
        result: api.eth.coins,
      };
      res.end(JSON.stringify(retObj));
    } else {
      const retObj = {
        msg: 'error',
        result: 'false',
      };
      res.end(JSON.stringify(retObj));
    }
  });

  api.get('/eth/coins/add', (req, res, next) => {
    const _coin = req.query.coin;
    
    if (_coin) {
      const retObj = api.ethAddCoin(_coin);
      res.end(JSON.stringify(retObj));
    } else {
      const retObj = {
        msg: 'error',
        result: 'coin param is empty',
      };
      res.end(JSON.stringify(retObj));
    }
  });

  api.get('/eth/coins/remove', (req, res, next) => {
    const _coin = req.query.coin;

    if (_coin) {
      api.eth.coins[_coin.toUpperCase()] = {};

      const retObj = {
        msg: 'success',
        result: 'true',
      };
      res.end(JSON.stringify(retObj));
    } else {
      const retObj = {
        msg: 'error',
        result: 'coin param is empty',
      };
      res.end(JSON.stringify(retObj));
    }
  });

  return api; 
};