package ssl

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"fmt"
	"io/ioutil"
	"strings"
	"text/template"

	"github.com/go-acme/lego/certcrypto"
	"github.com/go-acme/lego/certificate"
	"github.com/go-acme/lego/lego"
	"github.com/go-acme/lego/registration"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/files"
	"github.com/jitsucom/jitsu/configurator/ssh"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
)

const email = "reg@ksense.co"
const defaultHTTP01Location = "/var/www/html/.well-known/acme-challenge/"
const certificationServer = "https://acme-v02.api.letsencrypt.org/directory"
const certsPath = "/opt/letsencrypt/certs/"
const privateKeysPath = "/opt/letsencrypt/private/"
const configReloadCommand = "sudo nginx -s reload"
const nginxServerConfigPath = "/etc/nginx/custom-domains/"
const rwPermission = 0666

type CertificateService struct {
	enHosts               []string
	sshClient             *ssh.ClientWrapper
	configurationsService *storages.ConfigurationsService
	serverConfigTemplate  *template.Template
	nginxConfigPath       string
	acmeChallengePath     string
}

type EnUser struct {
	Email        string
	Registration *registration.Resource
	key          crypto.PrivateKey
}

func (u *EnUser) GetEmail() string {
	return u.Email
}
func (u EnUser) GetRegistration() *registration.Resource {
	return u.Registration
}
func (u *EnUser) GetPrivateKey() crypto.PrivateKey {
	return u.key
}

type MultipleServersProvider struct {
	SshClient              *ssh.ClientWrapper
	TargetHosts            []string
	HostChallengeDirectory string
	AcmeChallengePath      string
}

func (p *MultipleServersProvider) Present(domain, token, keyAuth string) error {
	challengeFileName := p.AcmeChallengePath + token
	err := ioutil.WriteFile(challengeFileName, []byte(keyAuth), rwPermission)
	if err != nil {
		return err
	}
	for _, host := range p.TargetHosts {
		logging.Infof("Copying [%s] domain challenge to [%s]", domain, host)
		if err := p.SshClient.CopyFile(challengeFileName, host, p.HostChallengeDirectory+token); err != nil {
			return err
		}
		logging.Info("Copy finished")
	}
	return nil
}

func (p *MultipleServersProvider) CleanUp(domain, token, keyAuth string) error {
	return nil
}

func (s *CertificateService) ExecuteHTTP01Challenge(domains []string) ([]byte, []byte, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	myUser := EnUser{
		Email: email,
		key:   privateKey,
	}
	http01Provider := &MultipleServersProvider{SshClient: s.sshClient, TargetHosts: s.enHosts, HostChallengeDirectory: defaultHTTP01Location, AcmeChallengePath: s.acmeChallengePath}

	config := lego.NewConfig(&myUser)
	config.CADirURL = certificationServer
	config.Certificate.KeyType = certcrypto.RSA2048
	client, err := lego.NewClient(config)
	if err != nil {
		return nil, nil, err
	}
	reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
	if err != nil {
		return nil, nil, err
	}
	myUser.Registration = reg
	err = client.Challenge.SetHTTP01Provider(http01Provider)
	if err != nil {
		return nil, nil, err
	}
	request := certificate.ObtainRequest{
		Domains: domains,
		Bundle:  true,
	}
	certificates, err := client.Certificate.Obtain(request)
	if err != nil {
		return nil, nil, err
	}
	return certificates.Certificate, certificates.PrivateKey, nil
}

type serverTemplateVariables struct {
	ProjectID   string
	ServerNames string
}

func (s *CertificateService) UploadCertificate(certificatePath string, privateKeyPath string, projectID string,
	approvedDomainNames []string, hostsToDeliver []string) error {
	serverNames := strings.Join(approvedDomainNames[:], " ")
	templateVariables := serverTemplateVariables{ProjectID: projectID, ServerNames: serverNames}
	var tpl bytes.Buffer
	if err := s.serverConfigTemplate.Execute(&tpl, templateVariables); err != nil {
		return err
	}
	serverConfigPath := s.nginxConfigPath + projectID + ".conf"
	if err := ioutil.WriteFile(serverConfigPath, tpl.Bytes(), rwPermission); err != nil {
		return err
	}
	for _, host := range hostsToDeliver {
		if err := s.sshClient.CopyFile(certificatePath, host, certsPath+projectID+"_fullchain.pem"); err != nil {
			return err
		}
		if err := s.sshClient.CopyFile(privateKeyPath, host, privateKeysPath+projectID+"_key.pem"); err != nil {
			return err
		}
		if err := s.sshClient.CopyFile(serverConfigPath, host, nginxServerConfigPath+projectID+".conf"); err != nil {
			return err
		}
		if err := s.sshClient.ExecuteCommand(host, configReloadCommand); err != nil {
			return err
		}
	}
	return nil
}

func NewCertificateService(sshClient *ssh.ClientWrapper, enHosts []string, configurationsService *storages.ConfigurationsService, serverConfigTemplatePath string, nginxSSLConfigPath string, acmeChallengePath string) (*CertificateService, error) {
	if configurationsService == nil {
		return nil, fmt.Errorf("failed to create custom domain processor: [firebase] must not be nil")
	}
	var serverConfigTemplate *template.Template
	if serverConfigTemplatePath != "" {
		var err error
		serverConfigTemplate, err = template.ParseFiles(serverConfigTemplatePath)
		if err != nil {
			return nil, err
		}
	}
	return &CertificateService{sshClient: sshClient, enHosts: enHosts, configurationsService: configurationsService, serverConfigTemplate: serverConfigTemplate, nginxConfigPath: files.FixPath(nginxSSLConfigPath), acmeChallengePath: files.FixPath(acmeChallengePath)}, nil
}

func (s *CertificateService) UpdateCustomDomains(ctx context.Context, projectID string, domains *entities.CustomDomains) error {
	return s.configurationsService.UpdateCustomDomain(ctx, projectID, domains)
}

func (s *CertificateService) LoadCustomDomains() (map[string]*entities.CustomDomains, error) {
	return s.configurationsService.GetAllCustomDomains()
}

func (s *CertificateService) LoadCustomDomainsByProjectID(projectID string) (*entities.CustomDomains, error) {
	return s.configurationsService.GetCustomDomainsByProjectID(projectID)
}
