package emails

const resetPasswordTemplate = `<!DOCTYPE html>
<html>
<body>
    <p>Hello,</p>
	<p>Follow this <a href='{{.Link}}'>link</a> to reset your Jitsu - an open-source data collection platform password for your {{.Email}} account.</p>
	<p>If you didn't ask to reset your password, you can ignore this email.</p>
	<p>Thanks,</p>
	<p>Your Jitsu - an open-source data collection platform team</p>
</body>
</html>`
