const { remote, ipcRenderer } = require('electron')
const Navigo = require('navigo')

console.log("%cStop!", "font: 2em sans-serif; color: yellow; background-color: red;");
console.log("%cThis is a browser feature intended for developers. If someone told you to copy-paste something here to enable a feature or “hack” someone’s account, it is a scam and will give them access to your account.", "font: 1.5em sans-serif; color: grey;");

require('dotenv').config()
require('./helpers/switch')
require('./helpers/clean')

global.app = remote.app
global.router = new Navigo(null, true, '#')

// SMTPClient is used for sending messages, IMAPClient for receiving.
global.SMTPClient = require('./modules/SMTPClient')
global.IMAPClient = require('./modules/IMAPClient')

// StateManager contains the current state, Threader handles email threading
// and Utils contains many utility functions
global.StateManager = require('./modules/StateManager')
global.Threader = require('./modules/Threader')
global.Utils = require('./modules/Utils')

// MailStore and AccountManager store mail items and accounts respectively.
global.MailStore = require('./modules/MailStore')
global.AccountManager = require('./modules/AccountManager')

// WelcomePage, SetupPage and MailPage all handle the rendering of specific pages.
global.WelcomePage = require('./modules/WelcomePage')
global.SetupPage = require('./modules/SetupPage')
global.MailPage = require('./modules/MailPage')

const { mail } = require('./modules/mail')

ipcRenderer.on('send', async (event, arg) => {
  SMTPClient.send(AccountManager.findAccount(arg.from), arg)
})

router.on({
  '/setup': () => { Utils.time(SetupPage.load) },
  '/welcome': () => { Utils.time(WelcomePage.load) },
  '/mail': () => { Utils.time(mail) }
}).resolve()

router.navigate('/setup')
