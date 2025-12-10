package main

import (
	"fmt"
	"strings"

	"github.com/jitsucom/bulker/jitsubase/utils"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func GetK8SClientSet(appContext *Context) (*kubernetes.Clientset, *rest.Config, error) {
	config := appContext.config.KubernetesClientConfig
	if config == "" || config == "local" {
		// creates the in-cluster config
		cc, err := rest.InClusterConfig()
		if err != nil {
			return nil, nil, fmt.Errorf("error getting in cluster config: %v", err)
		}
		clientset, err := kubernetes.NewForConfig(cc)
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes clientset: %v", err)
		}
		return clientset, cc, nil
	} else if strings.ContainsRune(config, '\n') {
		// suppose yaml file
		clientconfig, err := clientcmd.NewClientConfigFromBytes([]byte(config))
		if err != nil {
			return nil, nil, fmt.Errorf("error parsing kubernetes client config: %v", err)
		}
		rawConfig, _ := clientconfig.RawConfig()
		clientconfig = clientcmd.NewNonInteractiveClientConfig(rawConfig,
			utils.NvlString(appContext.config.KubernetesContext, rawConfig.CurrentContext),
			&clientcmd.ConfigOverrides{},
			&clientcmd.ClientConfigLoadingRules{})
		cc, err := clientconfig.ClientConfig()
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes client config: %v", err)
		}
		clientset, err := kubernetes.NewForConfig(cc)
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes clientset: %v", err)
		}
		return clientset, cc, nil
	} else {
		// suppose kubeconfig file path
		clientconfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			&clientcmd.ClientConfigLoadingRules{ExplicitPath: config},
			&clientcmd.ConfigOverrides{
				CurrentContext: appContext.config.KubernetesContext,
			})
		cc, err := clientconfig.ClientConfig()
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes client config: %v", err)
		}
		clientset, err := kubernetes.NewForConfig(cc)
		if err != nil {
			return nil, nil, fmt.Errorf("error creating kubernetes clientset: %v", err)
		}
		return clientset, cc, nil
	}
}
