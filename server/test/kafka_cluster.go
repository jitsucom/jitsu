package test

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/Shopify/sarama"
	"github.com/docker/go-connections/nat"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
	"net"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"
)

const (
	kafkaClusterName     = "test-kafka-cluster"
	zookeeperPort        = 2181
	kafkaBrokerPort      = 9092
	confluentPlatformVer = "6.1.1"
	zookeeperImage       = "confluentinc/cp-zookeeper:" + confluentPlatformVer
	kafkaImage           = "confluentinc/cp-kafka:" + confluentPlatformVer

	envKafkaClientPortVariable = "KAFKA_CLIENT_TEST_PORT"
)

type KafkaCluster struct {
	kafkaContainer     testcontainers.Container
	zookeeperContainer testcontainers.Container
	network            *testcontainers.DockerNetwork
	context            context.Context
	BootstrapServer    string
}

// NewKafkaCluster creates and starts test kafka cluster
func NewKafkaCluster(ctx context.Context) (*KafkaCluster, error) {
	ciKafkaPort := os.Getenv(envKafkaClientPortVariable)
	if ciKafkaPort != "" {
		port, err := strconv.Atoi(ciKafkaPort)
		if err != nil {
			return nil, err
		}
		return &KafkaCluster{context: context.Background(), BootstrapServer: fmt.Sprintf("0.0.0.0:%d", port)}, nil
	}
	kafkaCluster := &KafkaCluster{context: ctx}
	// creates a network, so kafka and zookeeper can communicate directly
	network, err := testcontainers.GenericNetwork(ctx, testcontainers.GenericNetworkRequest{
		NetworkRequest: testcontainers.NetworkRequest{Name: kafkaClusterName},
	})
	if err != nil {
		return nil, fmt.Errorf("could not create kafka cluster network: %v", err)
	}
	kafkaCluster.network = network.(*testcontainers.DockerNetwork)
	if err := kafkaCluster.startZookeeperContainer(); err != nil {
		kafkaCluster.Close()
		return nil, fmt.Errorf("could not start zookeeper container: %v", err)
	}
	if err := kafkaCluster.startKafkaContainer(); err != nil {
		kafkaCluster.Close()
		return nil, fmt.Errorf("could not start kafka container: %v", err)
	}
	return kafkaCluster, nil
}

func (kc *KafkaCluster) Close() {
	if kc == nil {
		return
	}
	if kc.kafkaContainer != nil {
		if err := kc.kafkaContainer.Terminate(kc.context); err != nil {
			logging.Warnf("could not terminate kafka container: %v", err)
		}
	}
	if kc.zookeeperContainer != nil {
		if err := kc.zookeeperContainer.Terminate(kc.context); err != nil {
			logging.Warnf("could not terminate zookeeper container: %v", err)
		}
	}
	if kc.network != nil {
		if err := kc.network.Remove(kc.context); err != nil {
			logging.Warnf("could not terminate kafka cluster network: %v", err)
		}
	}
}

func (kc *KafkaCluster) Contains(t *testing.T, topic string, objs []map[string]interface{}) error {
	cfg := sarama.NewConfig()
	cfg.Consumer.Offsets.Initial = sarama.OffsetOldest
	cfg.Consumer.Group.Rebalance.Strategy = sarama.BalanceStrategySticky
	client, err := sarama.NewConsumerGroup([]string{kc.BootstrapServer}, "test", cfg)
	if err != nil {
		return err
	}
	defer client.Close()
	ctx, stop := context.WithTimeout(context.Background(), time.Duration(5_000)*time.Millisecond)
	consumer := &testKafkaConsumer{
		message: make(chan map[string]interface{}),
	}
	wg := &sync.WaitGroup{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := client.Consume(ctx, []string{topic}, consumer); err != nil {
			logging.Warnf("could not fetch some messages: %v", err)
		}
	}()
	messages := make([]map[string]interface{}, 0, len(objs))
	contains := false
loop:
	for !contains {
		select {
		case <-ctx.Done():
			break loop
		case msg := <-consumer.message:
			messages = append(messages, msg)
			contains = sliceOfMapContainsSliceOfMap(messages, objs)
		}
	}
	stop()
	wg.Wait()
	if !contains {
		require.Failf(t, "", "%v doesn't contain %v", messages, objs)
	}
	return nil
}

// getKafkaHost gets the kafka host:port so it can be accessed from outside the container
func (kc *KafkaCluster) getKafkaHost(kafkaClientPort nat.Port) (string, error) {
	host, err := kc.kafkaContainer.Host(kc.context)
	if err != nil {
		return "", err
	}
	port, err := kc.kafkaContainer.MappedPort(kc.context, kafkaClientPort)
	if err != nil {
		return "", err
	}

	// returns the exposed kafka host:port
	return host + ":" + port.Port(), nil
}

func (kc *KafkaCluster) startZookeeperContainer() error {
	zookeeperPortStr := strconv.Itoa(zookeeperPort)
	// creates the zookeeper container, but do not start it yet
	container, err := testcontainers.GenericContainer(kc.context, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        zookeeperImage,
			ExposedPorts: []string{zookeeperPortStr},
			Env: map[string]string{
				"ZOOKEEPER_CLIENT_PORT": zookeeperPortStr,
				"ZOOKEEPER_TICK_TIME":   "2000",
			},
			Networks:       []string{kc.network.Name},
			NetworkAliases: map[string][]string{kc.network.Name: {"zookeeper"}},
		},
		Started: true,
	})
	if err != nil {
		return err
	}
	kc.zookeeperContainer = container
	return nil
}

func (kc *KafkaCluster) startKafkaContainer() error {
	kafkaClientPort, err := findFreePort()
	if err != nil {
		return fmt.Errorf("could not find free port: %v", err)
	}
	// creates the kafka container, but do not start it yet
	container, err := testcontainers.GenericContainer(kc.context, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        kafkaImage,
			ExposedPorts: []string{fmt.Sprintf("%d:%d", kafkaClientPort, kafkaClientPort)},
			Env: map[string]string{
				"KAFKA_BROKER_ID":                                "1",
				"KAFKA_ZOOKEEPER_CONNECT":                        fmt.Sprintf("zookeeper:%d", zookeeperPort),
				"KAFKA_LISTENER_SECURITY_PROTOCOL_MAP":           "CLIENT:PLAINTEXT,BROKER:PLAINTEXT",
				"KAFKA_ADVERTISED_LISTENERS":                     fmt.Sprintf("CLIENT://localhost:%d,BROKER://kafka:%d", kafkaClientPort, kafkaBrokerPort),
				"KAFKA_INTER_BROKER_LISTENER_NAME":               "BROKER",
				"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR":         "1",
				"KAFKA_TRANSACTION_STATE_LOG_MIN_ISR":            "1",
				"KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR": "1",
				"KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS":         "0",
			},
			Networks:       []string{kc.network.Name},
			NetworkAliases: map[string][]string{kc.network.Name: {"kafka"}},
			WaitingFor:     tcWait.ForLog("started (kafka.server.KafkaServer)"),
		},
		Started: true,
	})
	if err != nil {
		return err
	}
	kc.kafkaContainer = container
	exposedHost, err := kc.getKafkaHost(nat.Port(strconv.Itoa(kafkaClientPort)))
	if err != nil {
		return err
	}
	kc.BootstrapServer = exposedHost
	return nil
}

// findFreePort asks the kernel for a free open port that is ready to use.
func findFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// Consumer represents a Sarama consumer group consumer
type testKafkaConsumer struct {
	message chan map[string]interface{}
}

// Setup is run at the beginning of a new session, before ConsumeClaim
func (consumer *testKafkaConsumer) Setup(sarama.ConsumerGroupSession) error {
	return nil
}

// Cleanup is run at the end of a session, once all ConsumeClaim goroutines have exited
func (consumer *testKafkaConsumer) Cleanup(sarama.ConsumerGroupSession) error {
	return nil
}

// ConsumeClaim must start a consumer loop of ConsumerGroupClaim's Messages().
func (consumer *testKafkaConsumer) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	defer func() { close(consumer.message) }()

	for kafkaMsg := range claim.Messages() {
		msg := map[string]interface{}{}
		if err := json.Unmarshal(kafkaMsg.Value, &msg); err != nil {
			logging.Warnf("could not unmarshal kafka message: %v", err)
		} else {
			consumer.message <- msg
		}
		session.MarkMessage(kafkaMsg, "")
	}
	return nil
}

//sliceOfMapContainsSliceOfMap checks if all items of listB are contained by listA
//this method works with flatten maps
func sliceOfMapContainsSliceOfMap(listA []map[string]interface{}, listB []map[string]interface{}) bool {
	sliceContainsSlice := true
	for _, obj := range listB {
		isObjContained := false
		for _, msg := range listA {
			isObjContained = len(msg) > 0
			for k := range msg {
				isObjContained = isObjContained && msg[k] == obj[k]
			}
			if isObjContained {
				break
			}
		}
		sliceContainsSlice = sliceContainsSlice && isObjContained
	}
	return sliceContainsSlice
}
