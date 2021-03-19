package ssl

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"fmt"
	"github.com/go-acme/lego/certcrypto"
	"github.com/go-acme/lego/certificate"
	"github.com/go-acme/lego/lego"
	"github.com/go-acme/lego/registration"
	"github.com/jitsucom/eventnative/configurator/entities"
	"github.com/jitsucom/eventnative/configurator/files"
	"github.com/jitsucom/eventnative/configurator/ssh"
	"github.com/jitsucom/eventnative/configurator/storages"
	"github.com/jitsucom/eventnative/server/logging"
	"io/ioutil"
	"strings"
	"text/template"
)

const email = "reg@ksense.co"
const defaultHttp01Location = "/var/www/html/.well-known/acme-challenge/"
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

func (s *CertificateService) ExecuteHttp01Challenge(domains []string) ([]byte, []byte, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	myUser := EnUser{
		Email: email,
		key:   privateKey,
	}
	http01Provider := &MultipleServersProvider{SshClient: s.sshClient, TargetHosts: s.enHosts, HostChallengeDirectory: defaultHttp01Location, AcmeChallengePath: s.acmeChallengePath}

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
	ProjectId   string
	ServerNames string
}

func (s *CertificateService) UploadCertificate(certificatePath string, privateKeyPath string, projectId string,
	approvedDomainNames []string, hostsToDeliver []string) error {
	serverNames := strings.Join(approvedDomainNames[:], " ")
	templateVariables := serverTemplateVariables{ProjectId: projectId, ServerNames: serverNames}
	var tpl bytes.Buffer
	if err := s.serverConfigTemplate.Execute(&tpl, templateVariables); err != nil {
		return err
	}
	serverConfigPath := s.nginxConfigPath + projectId + ".conf"
	if err := ioutil.WriteFile(serverConfigPath, tpl.Bytes(), rwPermission); err != nil {
		return err
	}
	for _, host := range hostsToDeliver {
		if err := s.sshClient.CopyFile(certificatePath, host, certsPath+projectId+"_fullchain.pem"); err != nil {
			return err
		}
		if err := s.sshClient.CopyFile(privateKeyPath, host, privateKeysPath+projectId+"_key.pem"); err != nil {
			return err
		}
		if err := s.sshClient.CopyFile(serverConfigPath, host, nginxServerConfigPath+projectId+".conf"); err != nil {
			return err
		}
		if err := s.sshClient.ExecuteCommand(host, configReloadCommand); err != nil {
			return err
		}
	}
	return nil
}

func NewCertificateService(sshClient *ssh.ClientWrapper, enHosts []string, configurationsService *storages.ConfigurationsService, serverConfigTemplatePath string, nginxSSLConfigPath string, acmeChallengePath string) (*CertificateService, error) {
	if enHosts == nil || len(enHosts) == 0 {
		return nil, fmt.Errorf("failed to create custom domain processor: [enHosts] must not be empty")
	}
	if configurationsService == nil {
		return nil, fmt.Errorf("failed to create custom domain processor: [firebase] must not be nil")
	}
	serverConfigTemplate, err := template.ParseFiles(serverConfigTemplatePath)
	if err != nil {
		return nil, err
	}
	return &CertificateService{sshClient: sshClient, enHosts: enHosts, configurationsService: configurationsService, serverConfigTemplate: serverConfigTemplate, nginxConfigPath: files.FixPath(nginxSSLConfigPath), acmeChallengePath: files.FixPath(acmeChallengePath)}, nil
}

func (s *CertificateService) UpdateCustomDomains(projectId string, domains *entities.CustomDomains) error {
	return s.configurationsService.UpdateCustomDomain(projectId, domains)
}

func (s *CertificateService) LoadCustomDomains() (map[string]*entities.CustomDomains, error) {
	return s.configurationsService.GetCustomDomains()
}

func (s *CertificateService) LoadCustomDomainsByProjectId(projectId string) (*entities.CustomDomains, error) {
	return s.configurationsService.GetCustomDomainsByProjectId(projectId)
}
