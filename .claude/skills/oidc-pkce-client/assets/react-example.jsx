import React from 'react';

// oidc_client.js must be loaded as a plain <script> tag in the host HTML
// page, before this component's bundle, with window.OIDC_CONFIG already
// defined. It does all the PKCE/login/refresh work and exposes
// window.oidcUser / window.access_token / window.logout as globals — this
// component only mirrors that global state into React state.
class OidcLoginPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = { user: window.oidcUser || null };
    this.sync = this.sync.bind(this);
  }

  componentDidMount() {
    window.addEventListener('oidc:authenticated', this.sync);
    window.addEventListener('oidc:unauthenticated', this.sync);
    this.sync(); // in case oidc_client.js's bootstrap already ran before this mounted
  }

  componentWillUnmount() {
    window.removeEventListener('oidc:authenticated', this.sync);
    window.removeEventListener('oidc:unauthenticated', this.sync);
  }

  sync() {
    this.setState({ user: window.oidcUser || null });
  }

  render() {
    const { user } = this.state;

    if (!user) {
      return <p>Loading…</p>;
    }

    return (
      <div>
        <h1>Hello, {user.name || user.preferred_username || 'there'} {user.email}</h1>
        <button onClick={() => window.logout()}>Log Out</button>
      </div>
    );
  }
}

export default OidcLoginPage;

/*
Host HTML page contract (e.g. index.html):

  <script>
    window.OIDC_CONFIG = {
      client_id: 'YOUR_CLIENT_ID',
      authorization_endpoint: 'https://your-idp.example.com/authorize',
      token_endpoint: 'https://your-idp.example.com/token',
      end_session_endpoint: 'https://your-idp.example.com/logout',
      scope: 'openid profile email',
      redirect_uri: window.location.origin,
    };
  </script>
  <script src="/oidc_client.js"></script>

  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>

Where main.jsx does:

  import React from 'react';
  import ReactDOM from 'react-dom/client';
  import OidcLoginPage from './OidcLoginPage.jsx';

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <OidcLoginPage />
    </React.StrictMode>,
  );
*/
