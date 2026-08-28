package app

import (
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/jitsucom/bulker/bulkerapp/metrics"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type RepositoryChange struct {
	AddedDestinations     []*Destination
	ChangedDestinations   []*Destination
	RemovedDestinationIds []string
}

type Repository struct {
	appbase.Service
	configurationSource ConfigurationSource
	repository          atomic.Pointer[repositoryInternal]

	changesChan chan RepositoryChange
}

func (r *Repository) GetDestination(id string) *Destination {
	return r.repository.Load().GetDestination(id)
}

// LeaseDestination destination. destination cannot be closed while at lease one service is using it (e.g. batch consumer)
func (r *Repository) LeaseDestination(id string) *Destination {
	return r.repository.Load().LeaseDestination(id)
}

func (r *Repository) GetDestinations() []*Destination {
	return r.repository.Load().GetDestinations()
}

func (r *Repository) init() error {
	base := appbase.NewServiceBase("repository")
	internal := &repositoryInternal{
		Service:      base,
		destinations: make(map[string]*Destination),
	}
	err := internal.init(r.configurationSource)
	if err != nil {
		return err
	}

	oldInternal := r.repository.Load()

	toRetire := make([]*Destination, 0)

	repositoryChange := RepositoryChange{}
	var oldDestinations map[string]*Destination
	if oldInternal != nil {
		oldDestinations = oldInternal.destinations
	}
	for id, oldDestination := range oldDestinations {
		newDst, ok := internal.destinations[id]
		if !ok {
			r.Infof("Destination %s (%s) was removed. Ver: %s", id, oldDestination.config.BulkerType, oldDestination.config.UpdatedAt)
			toRetire = append(toRetire, oldDestination)
			repositoryChange.RemovedDestinationIds = append(repositoryChange.RemovedDestinationIds, id)
		} else if !newDst.equals(oldDestination) {
			r.Infof("Destination %s (%s) was updated. New Ver: %s", id, newDst.config.BulkerType, newDst.config.UpdatedAt)
			toRetire = append(toRetire, oldDestination)
			repositoryChange.ChangedDestinations = append(repositoryChange.ChangedDestinations, newDst)
		} else {
			//copy unchanged initialized destinations from old repository
			internal.destinations[id] = oldDestination
		}
	}
	for id, dst := range internal.destinations {
		_, ok := oldDestinations[id]
		if !ok {
			r.Debugf("Destination %s (%s) was added. Ver: %s", id, dst.config.BulkerType, dst.config.UpdatedAt)
			repositoryChange.AddedDestinations = append(repositoryChange.AddedDestinations, dst)
		}
	}
	r.repository.Store(internal)
	for _, dst := range toRetire {
		oldInternal.retireDestination(dst)
	}
	metrics.RepositoryDestinations("added").Add(float64(len(repositoryChange.AddedDestinations)))
	metrics.RepositoryDestinations("changed").Add(float64(len(repositoryChange.ChangedDestinations)))
	metrics.RepositoryDestinations("removed").Add(float64(len(repositoryChange.RemovedDestinationIds)))
	// live repository size (JITSU-191): internal.destinations is the full set
	// just stored — unchanged copies + added + changed, minus removed.
	metrics.RepositoryDestinationsCurrent.Set(float64(len(internal.destinations)))
	select {
	case r.changesChan <- repositoryChange:
	default:
	}
	return nil
}

func (r *Repository) ChangesChannel() <-chan RepositoryChange {
	return r.changesChan
}

func (r *Repository) changeListener() {
	for range r.configurationSource.ChangesChannel() {
		err := r.init()
		if err != nil {
			r.Errorf("failed to reload repository: %v", err)
		}
	}
	r.Infof("change listener stopped.")
}

// Close Repository
func (r *Repository) Close() error {
	return nil
}

type repositoryInternal struct {
	appbase.Service
	sync.Mutex
	destinations map[string]*Destination
}

func NewRepository(_ *Config, configurationSource ConfigurationSource) (*Repository, error) {
	base := appbase.NewServiceBase("repository")
	r := Repository{
		Service:             base,
		configurationSource: configurationSource,
		changesChan:         make(chan RepositoryChange, 10),
	}
	err := r.init()
	if err != nil {
		return nil, err
	}
	safego.RunWithRestart(r.changeListener)
	return &r, nil
}

func (r *repositoryInternal) init(configurationSource ConfigurationSource) error {
	r.Debugf("Initializing repository")
	for _, cfg := range configurationSource.GetDestinationConfigs() {
		r.addDestination(cfg)
	}
	return nil
}

func (r *repositoryInternal) addDestination(cfg *DestinationConfig) {
	options := bulker.StreamOptions{}
	for name, serializedOption := range cfg.StreamConfig.Options {
		opt, err := bulker.ParseOption(name, serializedOption)
		if err != nil {
			metrics.RepositoryDestinationInitError(cfg.Id()).Inc()
			//TODO: don't create working instance on options parsing error ?
			r.Errorf("destination %s – failed to parse option %s=%s : %v", cfg.Id(), name, serializedOption, err)
			continue
		}
		options.Add(opt)
	}
	configHash, _ := utils.HashAny(cfg)
	r.destinations[cfg.Id()] = &Destination{config: cfg, configHash: configHash, mode: bulker.ModeOption.Get(&options), streamOptions: &options, owner: r}
}

func (r *repositoryInternal) GetDestination(id string) *Destination {
	return r.destinations[id]
}

func (r *repositoryInternal) LeaseDestination(id string) *Destination {
	r.Lock()
	defer r.Unlock()
	dst := r.destinations[id]
	if dst != nil {
		dst.incLeases()
	}
	return dst
}

func (r *repositoryInternal) leaseDestination(destination *Destination) {
	r.Lock()
	defer r.Unlock()
	destination.incLeases()
}

func (r *repositoryInternal) releaseDestination(destination *Destination) {
	r.Lock()
	defer r.Unlock()
	destination.decLeases()
}

func (r *repositoryInternal) retireDestination(destination *Destination) {
	r.Lock()
	defer r.Unlock()
	destination.retire()
}

func (r *repositoryInternal) GetDestinations() []*Destination {
	destinations := make([]*Destination, 0, len(r.destinations))
	for _, destination := range r.destinations {
		destinations = append(destinations, destination)
	}
	return destinations
}

type Destination struct {
	sync.Mutex
	config        *DestinationConfig
	configHash    uint64
	mode          bulker.BulkMode
	bulker        bulker.Bulker
	streamOptions *bulker.StreamOptions

	owner       *repositoryInternal
	retired     bool
	leasesCount int
}

// TopicId generates topic id for Destination
func (d *Destination) TopicId(tableName, modeOverride, prefix string, partition int) (string, error) {
	if tableName == "" {
		tableName = d.config.StreamConfig.TableName
	}
	return MakeTopicId(d.Id(), utils.DefaultString(modeOverride, string(d.mode)), tableName, prefix, partition, true)
}

// Id returns destination id
func (d *Destination) Id() string {
	return d.config.Id()
}

// WorkspaceId returns id of workspace that owns the destination. Empty for special and env-configured destinations
func (d *Destination) WorkspaceId() string {
	return d.config.WorkspaceId
}

func (d *Destination) InitBulkerInstance() {
	if d.bulker != nil {
		return
	}
	var err error
	defer func() {
		if e := recover(); e != nil {
			metrics.RepositoryDestinationInitError(d.Id()).Inc()
			err = fmt.Errorf("panic : %v", e)
			logging.Errorf("Rejecting destination %s – %v", d.Id(), e)
			if d.bulker != nil {
				_ = d.bulker.Close()
			}
			d.bulker = &bulker.DummyBulker{Error: err}
		}
	}()

	d.bulker, err = bulker.CreateBulker(d.config.Config)
	if err != nil {
		metrics.RepositoryDestinationInitError(d.Id()).Inc()
		if d.bulker == nil {
			err = fmt.Errorf("failed to create bulker instance: %v", err)
			d.bulker = &bulker.DummyBulker{Error: err}
		}
		// we could not connect but problem may be resolved on the warehouse side later.
	}
	return
}

// Mode returns destination mode
func (d *Destination) Mode() bulker.BulkMode {
	return d.mode
}

func (d *Destination) retire() {
	d.retired = true
	if d.leasesCount == 0 {
		logging.Infof("[%s] closing retired destination. Ver: %s", d.Id(), d.config.UpdatedAt)
		if d.bulker != nil {
			_ = d.bulker.Close()
		}
	}
	return
}

func (d *Destination) incLeases() {
	d.leasesCount++
}

func (d *Destination) decLeases() {
	d.leasesCount--
	if d.retired && d.leasesCount == 0 {
		logging.Infof("[%s] closing retired destination. Ver: %s", d.Id(), d.config.UpdatedAt)
		if d.bulker != nil {
			_ = d.bulker.Close()
		}
	}
}

// Lease destination. destination cannot be closed while at lease one service is using it (e.g. batch consumer)
func (d *Destination) Lease() {
	d.owner.leaseDestination(d)
}

// Release destination. See Lease
func (d *Destination) Release() {
	d.owner.releaseDestination(d)
}

// equals compares destination with another destination
func (d *Destination) equals(o *Destination) bool {
	return d.configHash == o.configHash && d.config.UpdatedAt == o.config.UpdatedAt
}

//// AddBatchConsumer Add batch consumer to destination
//func (d *Destination) AddBatchConsumer(batchConsumer *BatchConsumer) {
//	d.Lock()
//	d.batchConsumers[batchConsumer.topicId] = batchConsumer
//	d.Unlock()
//}
//
//// RemoveBatchConsumer removes batch consumer from destination
//// and closes destination when no cosumers left and destination is retired
//func (d *Destination) RemoveBatchConsumer(batchConsumer *BatchConsumer) {
//	d.Lock()
//	bc := d.batchConsumers[batchConsumer.topicId]
//	if bc != batchConsumer {
//		logging.SystemErrorf("[%s] consumers for topic id: %s mismatches: %v != %v", d.Id(), batchConsumer.topicId, bc, batchConsumer)
//	}
//	delete(d.batchConsumers, batchConsumer.topicId)
//	if len(d.batchConsumers) == 0 {
//		if d.retired.Load() {
//			logging.Infof("[%s] closing retired destination", d.Id())
//			_ = d.bulker.Close()
//		} else {
//			logging.Warnf("[%s] no consumers left but destination is not retired", d.Id())
//		}
//	}
//	d.Unlock()
//}
