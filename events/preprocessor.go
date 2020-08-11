package events

type Preprocessor interface {
	Preprocess(fact Fact) (Fact, error)
}

type UserPreprocessor struct {
}

type S2sPreprocessor struct {
}
