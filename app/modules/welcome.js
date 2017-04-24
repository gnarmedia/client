const $ = require('jquery')

async function welcome () {
  if (!testLoaded('welcome')) return

  logger.debug(`We're loading up the welcome page now.`)
  page('welcome', ['basic', 'welcome'])

  if (process.env.NODE_ENV !== 'production') fillFields()

  $('#login-form').on('submit', async function onLogin (e) {
    e.preventDefault()
    let details = getItemsFromForm('login-form')
    users.addAccount(details)
  })
}

/**
 * When we're not in production, we can keep user information in a
 * .env file so that we don't have to enter it every time.
 *
 * @return {undefined}
 */
function fillFields () {
  $('#host_outgoing').val(process.env.HOST_OUTGOING)
  $('#port_outgoing').val(process.env.PORT_OUTGOING)
  $('#host').val(process.env.HOST)
  $('#port').val(process.env.PORT)
  $('#email').val(process.env.EMAIL)
  $('#password').val(process.env.PASSWORD)
  $('#secure').prop('checked', process.env.SECURE === 'true')
}

module.exports = { welcome }
