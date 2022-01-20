package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/emails"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/configurator/storages"
	jgeo "github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	jmiddleware "github.com/jitsucom/jitsu/server/middleware"
	jsystem "github.com/jitsucom/jitsu/server/system"
	"github.com/jitsucom/jitsu/server/telemetry"
	"net/http"
	"strings"
	"time"
)

const (
	ErrMalformedData   = "System error: malformed data"
	commonUIDFieldName = "_uid"
)

type SystemConfiguration struct {
	SMTP        bool
	SelfHosted  bool
	DockerHUBID string
	Tag         string
	BuiltAt     string
}

//OpenAPI is an openapi.ServerInterface implementation wrapper
type OpenAPI struct {
	authService           *authorization.Service
	emailService          *emails.Service
	configurationsService *storages.ConfigurationsService
	systemConfiguration   *SystemConfiguration
}

func NewOpenAPI(authService *authorization.Service, emailService *emails.Service, configurationsService *storages.ConfigurationsService,
	systemConfiguration *SystemConfiguration) *OpenAPI {
	return &OpenAPI{
		authService:           authService,
		emailService:          emailService,
		configurationsService: configurationsService,
		systemConfiguration:   systemConfiguration,
	}
}

func (oa *OpenAPI) GetGeoDataResolvers(c *gin.Context) {
	//check if middleware has aborted the request
	if c.IsAborted() {
		return
	}

	begin := time.Now()
	geoDataResolversMap, err := oa.configurationsService.GetGeoDataResolvers()
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(DestinationsGettingErrMsg, err))
		return
	}

	idConfig := map[string]*jgeo.ResolverConfig{}
	for projectID, geoDataResolverConfig := range geoDataResolversMap {
		if geoDataResolverConfig.MaxMind != nil && geoDataResolverConfig.MaxMind.Enabled {
			maxmindURL := geoDataResolverConfig.MaxMind.LicenseKey
			if !strings.HasPrefix(maxmindURL, jgeo.MaxmindPrefix) {
				maxmindURL = jgeo.MaxmindPrefix + maxmindURL
			}
			idConfig[projectID] = &jgeo.ResolverConfig{
				Type:   jgeo.MaxmindType,
				Config: jgeo.MaxMindConfig{MaxMindURL: maxmindURL},
			}
		}
	}

	resp := &jgeo.Payload{GeoResolvers: idConfig}
	b, _ := json.Marshal(resp)

	anyObject, err := convertToObject(b)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(b), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	logging.Debugf("Geo data resolvers response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, anyObject)
}

func (oa *OpenAPI) GetSystemConfiguration(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	exist, err := oa.authService.UsersExist()
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse("Error checking users existence", err))
		return
	}

	telemetryConfig, err := oa.configurationsService.GetParsedTelemetry()
	if err != nil && err != storages.ErrConfigurationNotFound {
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse("Error getting telemetry configuration", err))
		return
	}

	var telemetryUsageDisabled bool
	if telemetryConfig != nil && telemetryConfig.Disabled != nil {
		usageDisabled, ok := telemetryConfig.Disabled[telemetryUsageKey]
		if ok {
			telemetryUsageDisabled = usageDisabled
		}
	}

	currentConfiguration := jsystem.Configuration{
		Authorization:          oa.authService.GetAuthorizationType(),
		Users:                  exist,
		SMTP:                   oa.systemConfiguration.SMTP,
		SelfHosted:             oa.systemConfiguration.SelfHosted,
		SupportWidget:          !oa.systemConfiguration.SelfHosted,
		DefaultS3Bucket:        !oa.systemConfiguration.SelfHosted,
		SupportTrackingDomains: !oa.systemConfiguration.SelfHosted,
		TelemetryUsageDisabled: telemetryUsageDisabled,
		ShowBecomeUser:         !oa.systemConfiguration.SelfHosted,
		DockerHubID:            oa.systemConfiguration.DockerHUBID,
		Tag:                    oa.systemConfiguration.Tag,
		BuiltAt:                oa.systemConfiguration.BuiltAt,
	}

	data, _ := json.Marshal(currentConfiguration)
	object, err := convertToObject(data)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(data), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, object)
}

func (oa *OpenAPI) GetSystemVersion(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	version := openapi.VersionObject{Version: oa.systemConfiguration.Tag, BuiltAt: oa.systemConfiguration.BuiltAt}

	c.JSON(http.StatusOK, version)
}

func (oa *OpenAPI) GetUsersInfo(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	userID := c.GetString(middleware.UserIDKey)

	data, err := oa.configurationsService.GetConfigWithLock(authorization.UsersInfoCollection, userID)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(err.Error(), nil))
		return
	}

	object, err := convertToObject(data)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(data), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, object)
}

func (oa *OpenAPI) SetUsersInfo(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	userID := c.GetString(middleware.UserIDKey)

	req := &openapi.AnyObject{}
	err := c.BindJSON(req)
	if err != nil {
		bodyExtractionErrorMessage := fmt.Sprintf("Failed to get user info body from request: %v", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(bodyExtractionErrorMessage, nil))
		return
	}

	savedData, err := oa.configurationsService.SaveConfigWithLock(authorization.UsersInfoCollection, userID, req)
	if err != nil {
		configStoreErrorMessage := fmt.Sprintf("Failed to save user info [%s]: %v", userID, err)
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(configStoreErrorMessage, nil))
		return
	}

	anyObject, err := convertToObject(savedData)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(savedData), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, anyObject)
}

func (oa *OpenAPI) UsersOnboardedSignUp(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	req := &openapi.UsersOnboardedSignUpJSONRequestBody{}
	if err := c.BindJSON(req); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input JSON", err))
		return
	}

	if req.Email == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input data", errors.New("email is required field")))
		return
	}

	if req.Password == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input data", errors.New("password is required field")))
		return
	}

	if req.Name == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input data", errors.New("name is required field")))
		return
	}

	if req.Company == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input data", errors.New("company is required field")))
		return
	}

	td, err := oa.authService.SignUp(req.Email, req.Password)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(err.Error(), nil))
		return
	}

	//store telemetry settings
	err = oa.configurationsService.SaveTelemetry(map[string]bool{telemetryUsageKey: req.UsageOptout})
	if err != nil {
		logging.Errorf("Error saving telemetry configuration [%v] to storage: %v", req.UsageOptout, err)
	}

	//telemetry user
	user := &telemetry.UserData{
		Company:     req.Company,
		EmailOptout: req.EmailOptout,
		UsageOptout: req.UsageOptout,
	}
	if !req.EmailOptout {
		user.Email = req.Email
		user.Name = req.Name
	}
	telemetry.User(user)

	c.JSON(http.StatusOK, openapi.TokensResponse{
		AccessToken:  td.AccessTokenEntity.AccessToken,
		RefreshToken: td.RefreshTokenEntity.RefreshToken,
		UserId:       td.AccessTokenEntity.UserID,
	})
}

func (oa *OpenAPI) UsersPasswordChange(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	req := &openapi.UsersPasswordChangeJSONRequestBody{}
	if err := c.BindJSON(req); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input JSON", err))
		return
	}

	if req.NewPassword == nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input data", errors.New("new_password is required field")))
		return
	}

	//Extract token from all places including deprecated ones
	token, ok := middleware.ExtractBearerToken(c)
	if !ok {
		token = middleware.ExtractTokenFromDeprecatedParameters(c)
	}

	td, err := oa.authService.ChangePassword(req.ResetId, token, *req.NewPassword)
	if err != nil {
		if err == authorization.ErrResetIDNotFound {
			c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("The link has been expired!", nil))
			return
		}

		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, openapi.TokensResponse{
		AccessToken:  td.AccessTokenEntity.AccessToken,
		RefreshToken: td.RefreshTokenEntity.RefreshToken,
		UserId:       td.AccessTokenEntity.UserID,
	})
}

func (oa *OpenAPI) UsersPasswordReset(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	if !oa.emailService.IsConfigured() {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("SMTP isn't configured", nil))
		return
	}

	req := &openapi.UsersPasswordResetJSONRequestBody{}
	if err := c.BindJSON(req); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input JSON", err))
		return
	}

	if req.Email == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("email is required", nil))
		return
	}

	if req.Callback == nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("callback is required", nil))
		return
	}

	resetID, email, err := oa.authService.CreateResetID(req.Email)
	if err != nil {
		if err == authorization.ErrUserNotFound {
			c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(err.Error(), nil))
			return
		}

		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(err.Error(), nil))
		return
	}

	err = oa.emailService.SendResetPassword(email, strings.ReplaceAll(*req.Callback, "{{token}}", resetID))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse("Error sending email message", err))
		return
	}

	c.JSON(http.StatusOK, OpenAPIOKResponse())
}

func (oa *OpenAPI) UsersSignIn(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	req := &openapi.UsersSignInJSONRequestBody{}
	if err := c.BindJSON(req); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input JSON", err))
		return
	}

	if req.Email == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input data", errors.New("email is required body parameter")))
		return
	}

	if req.Password == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input data", errors.New("password is required body parameter")))
		return
	}

	td, err := oa.authService.SignIn(req.Email, req.Password)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, ErrorResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, openapi.TokensResponse{
		AccessToken:  td.AccessTokenEntity.AccessToken,
		RefreshToken: td.RefreshTokenEntity.RefreshToken,
		UserId:       td.AccessTokenEntity.UserID,
	})
}

func (oa *OpenAPI) UsersSignOut(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	token := c.GetString(middleware.TokenKey)

	err := oa.authService.SignOut(token)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, OpenAPIOKResponse())
}

func (oa *OpenAPI) UsersTokenRefresh(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	req := &openapi.UsersTokenRefreshJSONRequestBody{}
	if err := c.BindJSON(req); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid input JSON", err))
		return
	}

	if req.RefreshToken == "" {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse("Invalid data JSON", errors.New("refresh_token is required field")))
		return
	}

	td, err := oa.authService.Refresh(req.RefreshToken)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, ErrorResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, openapi.TokensResponse{
		AccessToken:  td.AccessTokenEntity.AccessToken,
		RefreshToken: td.RefreshTokenEntity.RefreshToken,
		UserId:       td.AccessTokenEntity.UserID,
	})
}

func (oa *OpenAPI) GetObjectsByProjectIDAndObjectType(c *gin.Context, projectIDI openapi.ProjectId, objectTypeI openapi.ObjectType) {
	if c.IsAborted() {
		return
	}

	projectID := string(projectIDI)
	objectType := string(objectTypeI)

	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	objects, err := oa.configurationsService.GetConfigWithLock(objectType, projectID)
	if err != nil {
		if err == storages.ErrConfigurationNotFound {
			objects, _ = json.Marshal(make(map[string]interface{}))
		}
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(fmt.Sprintf("failed to get objects for object type=[%s], projectID=[%s]: %v", objectType, projectID, err), nil))
		return
	}

	result, err := convertToObjectsArray(objects, objectType)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(objects), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, result)
}

func (oa *OpenAPI) SetObjectsByProjectIDAndObjectType(c *gin.Context, projectIDI openapi.ProjectId, objectTypeI openapi.ObjectType) {
	if c.IsAborted() {
		return
	}

	projectID := string(projectIDI)
	objectType := string(objectTypeI)

	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	req := &openapi.AnyObject{}
	err := c.BindJSON(req)
	if err != nil {
		bodyExtractionErrorMessage := fmt.Sprintf("Failed to get objects body from request: %v", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(bodyExtractionErrorMessage, nil))
		return
	}

	b, err := oa.configurationsService.SaveConfigWithLock(objectType, projectID, req)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(fmt.Sprintf("failed to save objects [%s], id=[%s]: %v", objectType, projectID, err), nil))
		return
	}

	newObject, err := convertToObject(b)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(b), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, newObject)
}

func (oa *OpenAPI) DeleteObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectIDI openapi.ProjectId, objectTypeI openapi.ObjectType, objectUIDI openapi.ObjectUid) {
	if c.IsAborted() {
		return
	}

	projectID := string(projectIDI)
	objectType := string(objectTypeI)
	objectUID := string(objectUIDI)

	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	objectArrayPath := getObjectArrayPathByObjectType(objectType)
	objectMeta := &storages.ObjectMeta{
		IDFieldPath: commonUIDFieldName,
		Value:       objectUID,
	}

	deletedObject, err := oa.configurationsService.DeleteObjectWithLock(objectType, projectID, objectArrayPath, objectMeta)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(fmt.Sprintf("failed to delete object [%s] in project [%s], id=[%s]: %v", objectType, projectID, objectUID, err), nil))
		return
	}

	result, err := convertToObject(deletedObject)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(deletedObject), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, result)
}

func (oa *OpenAPI) GetObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectIDI openapi.ProjectId, objectTypeI openapi.ObjectType, objectUIDI openapi.ObjectUid) {
	if c.IsAborted() {
		return
	}

	projectID := string(projectIDI)
	objectType := string(objectTypeI)
	objectUID := string(objectUIDI)

	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	objectArrayPath := getObjectArrayPathByObjectType(objectType)
	objectMeta := &storages.ObjectMeta{
		IDFieldPath: commonUIDFieldName,
		Value:       objectUID,
	}

	object, err := oa.configurationsService.GetObjectWithLock(objectType, projectID, objectArrayPath, objectMeta)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(fmt.Sprintf("failed to get object [%s] in project [%s], id=[%s]: %v", objectType, projectID, objectUID, err), nil))
		return
	}

	result, err := convertToObject(object)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(object), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, result)
}

func (oa *OpenAPI) PatchObjectsByProjectIDAndObjectTypeAndID(c *gin.Context, projectIDI openapi.ProjectId, objectTypeI openapi.ObjectType, objectUIDI openapi.ObjectUid) {
	if c.IsAborted() {
		return
	}

	projectID := string(projectIDI)
	objectType := string(objectTypeI)
	objectUID := string(objectUIDI)

	if c.GetString(middleware.ProjectIDKey) != projectID {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	req := &openapi.AnyObject{}
	err := c.BindJSON(req)
	if err != nil {
		bodyExtractionErrorMessage := fmt.Sprintf("Failed to get patch objects body from request: %v", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(bodyExtractionErrorMessage, nil))
		return
	}

	patchPayload := &storages.PatchPayload{
		ObjectArrayPath: getObjectArrayPathByObjectType(objectType),
		ObjectMeta: &storages.ObjectMeta{
			IDFieldPath: commonUIDFieldName,
			Value:       objectUID,
		},
		//extract
		Patch: req.AdditionalProperties,
	}

	newObject, err := oa.configurationsService.PatchConfigWithLock(objectType, projectID, patchPayload)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(fmt.Sprintf("failed to patch object [%s] in project [%s], id=[%s]: %v", objectType, projectID, objectUID, err), nil))
		return
	}

	result, err := convertToObject(newObject)
	if err != nil {
		logging.Errorf("System error: malformed data %s: %v", string(newObject), err)
		c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
		return
	}

	c.JSON(http.StatusOK, result)
}

func (oa *OpenAPI) GetProjects(c *gin.Context) {
	if c.IsAborted() {
		return
	}

	projects, err := oa.authService.GetUserProjects(c.GetString(middleware.UserIDKey))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, ErrorResponse(fmt.Sprintf("failed to get user's projects: %v", err), nil))
		return
	}

	result := openapi.AnyArray{}
	for _, project := range projects {
		data, _ := json.Marshal(project)
		object, err := convertToObject(data)
		if err != nil {
			logging.Errorf("System error: malformed data %s: %v", string(data), err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, ErrorResponse(ErrMalformedData, nil))
			return
		}

		result = append(result, *object)
	}

	c.JSON(http.StatusOK, result)
}

//OpenAPIOKResponse returns openapi ok response wrapper
func OpenAPIOKResponse() *openapi.StatusResponse {
	return &openapi.StatusResponse{Status: jmiddleware.StatusOK}
}

//ErrorResponse returns openapi error response wrapper
func ErrorResponse(message string, err error) *openapi.ErrorObject {
	eo := &openapi.ErrorObject{
		Message: message,
	}
	if err != nil {
		errMsg := err.Error()
		eo.Error = &errMsg
	}

	return eo
}

func convertToObjectsArray(objects []byte, objectType string) (*openapi.AnyArray, error) {
	anyObjectWithResult, err := convertToObject(objects)
	if err != nil {
		return nil, err
	}

	var arrayOfObjects []interface{}
	arrayPath := getObjectArrayPathByObjectType(objectType)
	result := openapi.AnyArray{}

	//check if payload has structure: { key: []} or just {}
	if arrayPath != "" {
		arrayOfObjectsI, ok := anyObjectWithResult.Get(arrayPath)
		if !ok {
			return nil, fmt.Errorf("objects [%s] doesn't have path [%s] in array", objectType, arrayPath)
		}

		arrayOfObjects, ok = arrayOfObjectsI.([]interface{})
		if !ok {
			return nil, fmt.Errorf("objects [%s] path [%s] must be an array", objectType, arrayPath)
		}

		for _, object := range arrayOfObjects {
			anyObject := openapi.AnyObject{}
			b, _ := json.Marshal(object)
			if err := (&anyObject).UnmarshalJSON(b); err != nil {
				return nil, fmt.Errorf("error serializing object in array: %v", err)
			}

			result = append(result, anyObject)
		}

	} else {
		anyObject := openapi.AnyObject{}
		if err := (&anyObject).UnmarshalJSON(objects); err != nil {
			return nil, fmt.Errorf("error serializing object in array: %v", err)
		}

		result = append(result, anyObject)
	}

	return &result, nil
}

func convertToObject(b []byte) (*openapi.AnyObject, error) {
	anyObject := openapi.AnyObject{}
	if err := anyObject.UnmarshalJSON(b); err != nil {
		return nil, fmt.Errorf("error serializing response: %v", err)
	}

	return &anyObject, nil
}

//paths some entities arrays can be different from entity type
func getObjectArrayPathByObjectType(objectType string) string {
	switch objectType {
	case "api_keys":
		return "keys"
	case "geo_data_resolvers":
		return ""
	default:
		return objectType
	}
}
