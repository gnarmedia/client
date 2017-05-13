const { ipcRenderer, remote }   = require('electron')
const { timeout, TimeoutError } = require('promise-timeout')
const searchInPage              = require('electron-in-page-search').default
const $                         = require('jquery')

function MailPage () {}

/*
TODO:
- Add ability to click on emails to see body.
 */

MailPage.load = async function () {
  if (!testLoaded('mail')) return

  logger.debug(`We're loading up the mail page now.`)
  StateManager.page('mail', ['basic', 'mail'])

  /*----------  ENSURE ACCOUNT SET IN STATE  ----------*/
  if (typeof StateManager.state.account === 'undefined') {
    let account = (await AccountManager.listAccounts())[0]
    StateManager.change('account', Object.assign(StateManager.state.account, { hash: account.hash, email: account.user }))
  }

  /*----------  RETRIEVE & SETUP ACCOUNT  ----------*/
  let account = await AccountManager.findAccount(StateManager.state.account.email)
  let folders = account.folders

  console.log(account)

  await MailStore.createEmailDB(account.user)

  /*----------  ENSURE FOLDER SET IN STATE  ----------*/
  if (typeof StateManager.state.account.folder === 'undefined') {
    // Due to companies not all naming their main inbox "INBOX" (as defined in the RFC),
    // we have to search through them, looking for one which contains the word "inbox".
    for (let folder in folders) {
      if (folder.toLowerCase() == 'inbox') {
        StateManager.update('account', Object.assign(StateManager.state.account, {
          folder: [{ name: folder, delimiter: account.folders[folder].delimiter }]
        }))
      }
    }
  }

  /*----------  ACTIVATE MAIL BUTTON  ----------*/
  $('#compose-button').click(() => {
    ipcRenderer.send('open', { file: 'compose' })
  })

  /*----------  ACTIVATE RELOAD BUTTON  ----------*/
  $('#refresh-button').click(() => {
    MailPage.reload()
  })

  /*----------  SET FOLDER LIST  ----------*/
  $('#folders').html(MailPage.generateFolderList(folders, [], false))
  MailPage.linkFolders($('#folders').children().children())
  MailPage.highlightFolder()

  /*----------  ADD MAIL ITEMS  ----------*/
  MailPage.render()
  MailPage.retrieveEmailBodies()

  /*----------  SEARCH IN MAIL WINDOW  ----------*/
  MailPage.enableSearch()
}

MailPage.generateFolderList = function (folders, journey, depth) {
  let html = ''
  for (let prop in folders) {
    temp = journey.concat({ name: prop, delimiter: folders[prop].delimiter })
    if (depth) {
      html += `
        <div class="col s12 no-padding center-align">
          <div class="waves-effect waves-teal btn-flat wide no=padding folder-tree" id="${btoa(JSON.stringify(temp))}">${prop} ${MailPage.generateFolderList(folders[prop].children, temp, depth)}</div>
        </div>
      `
    } else {
      html += `
        <div class="col s12 no-padding center-align">
          <div class="waves-effect waves-teal btn-flat wide no=padding folder-tree" id="${btoa(JSON.stringify(temp))}">${prop}</div>
        </div>
      `
      html += MailPage.generateFolderList(folders[prop].children, temp, depth)
    }
  }
  return html
}

MailPage.linkFolders = function (children) {
  children.each((index, item) => {
    $(`#${item.id.replace(/=/g, '\\=')}`).click((element) => {
      logger.log(`Switching page to ${atob(element.target.id)}`)
      StateManager.update('account', Object.assign(StateManager.state.account, {
        folder: JSON.parse(atob(element.target.id))
      }))
      $(`.folder-tree`).removeClass('teal lighten-2')
      $(`#${element.target.id.replace(/=/g, '\\=')}`).addClass('teal lighten-2')
      MailPage.render()
    })

    let items = $(`#${item.id.replace(/=/g, '\\=')}`).children().children()
    if (items.length) {
      MailPage.linkFolders(items)
    }
  })
}

MailPage.highlightFolder = function () {
  $(`.folder-tree`).removeClass('teal lighten-2')
  $(`#${btoa(JSON.stringify(StateManager.state.account.folder)).replace(/=/g, '\\=')}`).addClass('teal lighten-2')
}

MailPage.render = async function(page) {
  page = page || 0

  let mail = await MailStore.findEmails(StateManager.state.account.email, StateManager.state.account.folder, { uid: 1, isThreadChild: 1 }, page * 250, 250)
  Header.setLoc([StateManager.state.account.email].concat(StateManager.state.account.folder.map((val) => { return val.name })))

  if (!page) {
    $('#mail').html('')
    $('#message-holder').html(`<div id="message"></div>`)
  }

  let html = ""
  for (let i = 0; i < mail.length; i++) {
    if (!mail[i].isThreadChild) {
      html += `<e-mail class="email-item" data-uid="${escape(mail[i].uid)}"></e-mail>`
    }
  }

  if (mail.length === 0) $('#mail').html('This folder is empty ;(')
  if (await MailStore.countEmails(StateManager.state.account.email, StateManager.state.account.folder) > 250 * (page + 1)) {
    html += `<button class='load-more'>Load more...</button>`
    $('.load-more').remove()
  }

  $('#mail').append(html)

  $('.email-item').off('click')
  $('.email-item').click((e) => { MailPage.renderEmail(unescape(e.currentTarget.attributes['data-uid'].nodeValue)) })

  $('.load-more').off('click')
  $('.load-more').click((e) => { MailPage.render(page + 1) })
}

MailPage.reload = async function() {
  (await AccountManager.getIMAP(StateManager.state.account.email)).updateAccount()
}

MailPage.renderEmail = async function (uid) {
  let email = await MailStore.loadEmailBody(StateManager.state.account.email, uid)
  console.log(email)
}

MailPage.retrieveEmailBodies = async function() {
  let accounts = await AccountManager.listAccounts()
  for (let i = 0; i < accounts.length; i++) {
    let email = accounts[i].user
    let toGrab = await MailStore.loadEmailsWithoutBody(email)
    let total = toGrab.length;

    if (total) {
      let limit = 8
      let currentIter = 0
      let currentCount = 0

      let promises = []
      for (let j = 0; j < limit; j++) {
        promises.push(AccountManager.getIMAP(email))
      }
      let clientsFree = await Promise.all(promises)

      let interval = setInterval(async () => {
        if (currentIter == total - 1) {
          clearInterval(interval)
          setTimeout(function () {
            for (let i = 0; i < clientsFree.length; i++) {
              clientsFree[i].client.end()
            }
          }, 20000)
        } else if (currentCount < limit) {
          logger.log(`Grabbing email body ${currentIter + 1} / ${total - 1}`)
          currentCount++
          currentIter++
          let client = clientsFree.pop()
          try { await timeout(client.getEmailBody(toGrab[currentIter].uid), 20000) } 
          catch(e) {
            if (e instanceof TimeoutError) logger.error('Timeout on one of our emails grabs...')
            else throw e
          }
          clientsFree.push(client)

          currentCount--
        }
      }, 50)
    }
  }
}

MailPage.enableSearch = function() {
  const listener = new window.keypress.Listener()
  listener.simple_combo('ctrl f', () => {
    const searchInWindow = searchInPage(remote.getCurrentWebContents())
    searchInWindow.openSearchWindow()
  })
}

customElements.define('e-mail', class extends HTMLElement {
  constructor () {
    super()

    // Shadow root is it's *own* entire DOM.  This makes it impact less when
    // we change and search through other parts of the DOM, *hopefully* making it
    // slightly quicker.  It also allows us to use the cool <e-mail> tags.
    // const shadowRoot = this.attachShadow({ mode: 'open' })
    this.innerHTML = `
      <div>Loading...</div>
    `

    // We're able to assume some values from the current state.
    // However, we don't rely on it, preferring instead to find it in the email itself.
    let email = this.getAttribute('data-email') ||
                StateManager.state.account.email
    let uid = unescape(this.getAttribute('data-uid'))

    MailStore.loadEmail(email, uid).then((mail) => {
      // Attach a shadow root to <e-mail>.
      // NOTE: All of these *have* to be HTML escaped.  Consider using `Clean.escape(string)` which
      // is globally accessible.
      this.innerHTML = `
        <div class="mail-item">
          <div class="multi mail-checkbox"><input type="checkbox" id="${mail.uid}" />
            <label for="${mail.uid}"></label>
          </div>
          <div class="text ${mail.flags.includes('\\Seen') ? `read` : `unread`}">
            <div class="subject">
              <div class="subject-text">${mail.threadMsg && mail.threadMsg.length ? `(${mail.threadMsg.length + 1})` : ``} ${Clean.escape(mail.subject)}</div>
            </div>
            <div class="sender">
              <div class="sender-text">${Clean.escape(typeof mail.from !== 'undefined' ? mail.from.value[0].name || mail.from.value[0].address : 'No Sender...')}</div>
            </div>
            <div class="date teal-text right-align">${Utils.alterDate(mail.date)}</div>
          </div>
        </div>
      `
    })
  }
})

module.exports = MailPage