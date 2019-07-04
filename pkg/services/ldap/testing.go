package ldap

import (
	"crypto/tls"

	"gopkg.in/ldap.v3"
)

// MockConnection struct for testing
type MockConnection struct {
	SearchResult     *ldap.SearchResult
	SearchError      error
	SearchCalled     bool
	SearchAttributes []string

	AddParams *ldap.AddRequest
	AddCalled bool

	DelParams *ldap.DelRequest
	DelCalled bool

	bindProvider                func(username, password string) error
	unauthenticatedBindProvider func(username string) error
}

// Bind mocks Bind connection function
func (c *MockConnection) Bind(username, password string) error {
	if c.bindProvider != nil {
		return c.bindProvider(username, password)
	}

	return nil
}

// UnauthenticatedBind mocks UnauthenticatedBind connection function
func (c *MockConnection) UnauthenticatedBind(username string) error {
	if c.unauthenticatedBindProvider != nil {
		return c.unauthenticatedBindProvider(username)
	}

	return nil
}

// Close mocks Close connection function
func (c *MockConnection) Close() {}

func (c *MockConnection) setSearchResult(result *ldap.SearchResult) {
	c.SearchResult = result
}

func (c *MockConnection) setSearchError(err error) {
	c.SearchError = err
}

// Search mocks Search connection function
func (c *MockConnection) Search(sr *ldap.SearchRequest) (*ldap.SearchResult, error) {
	c.SearchCalled = true
	c.SearchAttributes = sr.Attributes

	if c.SearchError != nil {
		return nil, c.SearchError
	}

	return c.SearchResult, nil
}

// Add mocks Add connection function
func (c *MockConnection) Add(request *ldap.AddRequest) error {
	c.AddCalled = true
	c.AddParams = request
	return nil
}

// Del mocks Del connection function
func (c *MockConnection) Del(request *ldap.DelRequest) error {
	c.DelCalled = true
	c.DelParams = request
	return nil
}

// StartTLS mocks StartTLS connection function
func (c *MockConnection) StartTLS(*tls.Config) error {
	return nil
}
