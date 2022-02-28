package emails

import (
	"text/template"

	"github.com/pkg/errors"
)

type templateSubject string

func (s templateSubject) String() string {
	return string(s)
}

type templateValues struct {
	Email     string
	Link      string
	Signature string
}

const (
	resetPassword  templateSubject = "Reset your password for Jitsu - an open-source data collection platform"
	accountCreated templateSubject = "Your Jitsu account has been created"
)

func parseTemplates() (map[templateSubject]*template.Template, error) {
	result := make(map[templateSubject]*template.Template, len(rawTemplates))
	for subject, value := range rawTemplates {
		if tmplt, err := template.New(subject.String()).Parse(value); err != nil {
			return nil, errors.Wrapf(err, "parse template '%s'", subject)
		} else {
			result[subject] = tmplt
		}
	}

	return result, nil
}

var rawTemplates = map[templateSubject]string{
	resetPassword: `<!DOCTYPE html>
<html>
<body>
    <p>Hello,</p>
	<p>Follow this <a href='{{.Link}}'>link</a> to reset your Jitsu - an open-source data collection platform password for your {{.Email}} account.</p>
	<p>If you didn't ask to reset your password, you can ignore this email.</p>
	<p>Thanks,</p>
	<p>{{.Signature}}</p>
</body>
</html>`,

	accountCreated: `<DOCTYPE html>
<html>
<body>
	<p>Hello and welcome!</p>
	<p>Your new Jitsu {{.Email}} account has been registered. Follow this <a href='{{.Link}}'>link</a> to set the password.</p>
	<p>If you didn't expect this, you can safely ignore this email.</p>
	<p>Thanks,</p>
	<p>{{.Signature}}</p>
</body>
</html>`,
}
