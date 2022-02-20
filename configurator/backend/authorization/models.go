package authorization

//User is a Redis entity for storing user sign data
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
	ID   string `json:"_id"`
	Name string `json:"_name"`
}

//TokenEntity is a Redis entity for storing authorization
type TokenEntity struct {
	UserID       string `json:"user_id,omitempty" redis:"user_id"`
	ExpiredAt    string `json:"expired_at,omitempty" redis:"expired_at"`
	TokenType    string `json:"token_type,omitempty" redis:"token_type"`
	AccessToken  string `json:"access_token,omitempty" redis:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty" redis:"refresh_token"`
}

type SSOTokenEntity struct {
	UserID      string `json:"user_id,omitempty" redis:"user_id"`
	ExpiredAt   string `json:"expired_at,omitempty" redis:"expired_at"`
	SSOProvider string `json:"token_type,omitempty" redis:"token_type"`
	AccessToken string `json:"access_token,omitempty" redis:"access_token"`
}

//TokenDetails is a dto for both access and refresh tokens
type TokenDetails struct {
	AccessTokenEntity  *TokenEntity
	RefreshTokenEntity *TokenEntity
}
