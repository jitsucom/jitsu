package singer

type PortionConsumer interface {
	Consume(representation *OutputRepresentation) error
}
