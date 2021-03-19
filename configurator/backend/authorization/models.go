package authorization

type JwtToken struct {
	Token  string
	UUID   string
	Exp    int64
	UserId string
}

type TokenDetails struct {
	AccessToken  *JwtToken
	RefreshToken *JwtToken
}

//Redis entity
type User struct {
	ID             string `json:"id,omitempty" redis:"id"`
	Email          string `json:"email,omitempty" redis:"email"`
	HashedPassword string `json:"hashed_password,omitempty" redis:"hashed_password"`
}

// UserInfo and Project models are used only to extract _project._id
type UserInfo struct {
	Project Project `json:"_project"`
}

type Project struct {
	Id   string `json:"_id"`
	Name string `json:"_name"`
}
