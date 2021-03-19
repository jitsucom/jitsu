package ssh

import (
	"github.com/bramvdbogaerde/go-scp"
	"github.com/bramvdbogaerde/go-scp/auth"
	"golang.org/x/crypto/ssh"
	"os"
	"strings"
)

type ClientWrapper struct {
	host      string
	sshConfig *ssh.ClientConfig
}

const defaultSSHPort = "22"
const rwPermission = "0666"

func (clientWrapper *ClientWrapper) CopyFile(sourceFilePath string, host string, targetFilePath string) error {

	f, err := os.Open(sourceFilePath)
	if err != nil {
		return err
	}
	defer f.Close()
	client := scp.NewClient(fixHostName(host), clientWrapper.sshConfig)
	err = client.Connect()
	if err != nil {
		return err
	}
	defer client.Close()
	return client.CopyFile(f, targetFilePath, rwPermission)
}

// Adds port if it was not set before
func fixHostName(host string) string {
	if !strings.Contains(host, ":") {
		return host + ":" + defaultSSHPort
	}
	return host
}

func (clientWrapper *ClientWrapper) ExecuteCommand(host string, command string) error {
	conn, err := ssh.Dial("tcp", fixHostName(host), clientWrapper.sshConfig)
	if err != nil {
		return err
	}
	defer conn.Close()
	sess, err := conn.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()
	return sess.Run(command)
}

func NewSshClient(privateKeyPath string, user string) (*ClientWrapper, error) {
	clientConfig, _ := auth.PrivateKey(user, privateKeyPath, ssh.InsecureIgnoreHostKey())
	return &ClientWrapper{sshConfig: &clientConfig}, nil
}
