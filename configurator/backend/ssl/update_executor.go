package ssl

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/files"
	entime "github.com/jitsucom/jitsu/configurator/time"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"io/ioutil"
	"os/exec"
	"strings"
	"time"
)

const maxDaysBeforeExpiration = 30
const cnameFailedStatus = "cname_failed"
const cnameOkStatus = "cname_ok"
const okStatus = "ok"

type UpdateExecutor struct {
	sslService               *CertificateService
	enHosts                  []string
	user                     string
	privateKeyPath           string
	enCName                  string // required to validate if CNAME is set to our balancer
	sslCertificatesStorePath string
	sslPkStorePath           string
	acmeChallengePath        string
}

func NewSSLUpdateExecutor(processor *CertificateService, targetHosts []string, user string, privateKeyPath string, balancerName string, certsPath string, pkPath string, acmeChallengePath string) *UpdateExecutor {
	return &UpdateExecutor{sslService: processor, enHosts: targetHosts, user: user, privateKeyPath: privateKeyPath, enCName: balancerName, sslCertificatesStorePath: files.FixPath(certsPath), sslPkStorePath: files.FixPath(pkPath), acmeChallengePath: files.FixPath(acmeChallengePath)}
}

func (e *UpdateExecutor) Schedule(interval time.Duration) {
	ticker := time.NewTicker(interval)
	safego.RunWithRestart(func() {
		for {
			<-ticker.C
			if err := e.Run(context.Background()); err != nil {
				logging.Errorf("Failed to update SSL certificates: %s", err)
			}
		}
	})
}

func (e *UpdateExecutor) Run(ctx context.Context) error {
	domainsPerProject, err := e.sslService.LoadCustomDomains()
	if err != nil {
		return err
	}
	for projectID, domains := range domainsPerProject {
		if err := e.processProjectDomains(ctx, projectID, domains); err != nil {
			logging.Error(err)
			return err
		}
	}
	return nil
}

func (e *UpdateExecutor) RunForProject(ctx context.Context, projectID string) error {
	domains, err := e.sslService.LoadCustomDomainsByProjectID(projectID)
	if err != nil {
		return err
	}
	return e.processProjectDomains(ctx, projectID, domains)
}

func (e *UpdateExecutor) processProjectDomains(ctx context.Context, projectID string, domains *entities.CustomDomains) error {
	validDomains := filterExistingCNames(domains, e.enCName)
	updateRequired, err := updateRequired(domains, validDomains)
	if err != nil {
		return err
	}
	if !updateRequired {
		return e.sslService.UpdateCustomDomains(ctx, projectID, domains)
	}

	certificate, privateKey, err := e.sslService.ExecuteHTTP01Challenge(validDomains)
	if err != nil {
		return err
	}
	certFileName := e.sslCertificatesStorePath + projectID + "_cert.pem"
	err = ioutil.WriteFile(certFileName, certificate, rwPermission)
	if err != nil {
		return err
	}
	pkFileName := e.privateKeyPath + projectID + "_pk.pem"
	err = ioutil.WriteFile(pkFileName, privateKey, rwPermission)
	if err != nil {
		return err
	}
	if err = e.sslService.UploadCertificate(certFileName, pkFileName, projectID, validDomains, e.enHosts); err != nil {
		return err
	}

	for _, domain := range domains.Domains {
		if contains(validDomains, domain.Name) {
			domain.Status = okStatus
		}
	}
	expirationDate := time.Now().UTC().Add(time.Hour * time.Duration(24*90))
	domains.CertificateExpirationDate = entime.AsISOString(expirationDate)
	domains.Certificate = string(certificate)
	domains.PrivateKey = string(privateKey)
	err = e.sslService.UpdateCustomDomains(ctx, projectID, domains)
	if err != nil {
		return err
	}
	return nil
}

func updateRequired(domains *entities.CustomDomains, validDomains []string) (bool, error) {
	if validDomains == nil || len(validDomains) == 0 {
		return false, nil
	}
	if domains.CertificateExpirationDate == "" {
		return true, nil
	}
	if strings.HasSuffix(domains.Domains[0].Name, ".efeer.com") && (domains.Certificate == "" || domains.PrivateKey == "") {
		return true, nil
	}
	expirationDate, err := entime.ParseISOString(domains.CertificateExpirationDate)
	if err != nil {
		return false, err
	}
	days := expirationDate.Sub(time.Now().UTC()).Hours() / 24

	if days < maxDaysBeforeExpiration {
		return true, nil
	}
	for _, domain := range domains.Domains {
		if contains(validDomains, domain.Name) && domain.Status != okStatus {
			return true, nil
		}
	}
	return false, nil
}

func contains(domains []string, name string) bool {
	for _, domain := range domains {
		if name == domain {
			return true
		}
	}
	return false
}

func filterExistingCNames(domains *entities.CustomDomains, enCName string) []string {
	resultDomains := make([]string, 0)
	for _, domain := range domains.Domains {

		if checkDomain(domain.Name, enCName) {
			resultDomains = append(resultDomains, domain.Name)
			if domain.Status != okStatus {
				domain.Status = cnameOkStatus
			}
		} else {
			domain.Status = cnameFailedStatus
		}
	}
	return resultDomains
}

func checkDomain(domain string, validCName string) bool {
	isNotDigit := func(c rune) bool { return c < '0' || c > '9' }
	onlyNumbers := strings.IndexFunc(domain, isNotDigit) == -1
	if onlyNumbers {
		return false
	}
	out, err := exec.Command("nslookup", domain).Output()
	if err != nil {
		logging.Infof("Failed to check domain %s: %s", domain, err.Error())
		return false
	}
	nsLookupOutput := fmt.Sprintf("%s", out)
	return strings.Contains(nsLookupOutput, "canonical name = "+validCName)
}
